import Anthropic from "@anthropic-ai/sdk";
import { DialogueTurn } from "./dialogue.js";
import { Client, findClientByQuery } from "../store/clients.js";

/**
 * Inbound-lookup dialogue mode.
 *
 * Mirror of the outbound dialogue's tool-use pattern, but with the roles
 * flipped: Aria is the assistant ANSWERING the phone for a homecare
 * practice. A payer rep dials in, identifies themselves, names a patient,
 * and Aria reads back the relevant record.
 *
 * Two tools:
 *   - lookup_client(query) → Aria calls this once she has enough to search
 *     (a name or member ID with reasonable confidence). We resolve the
 *     query against the local clients store and feed the result back.
 *   - submit_turn(...) → the final response for this turn, same pattern
 *     as outbound dialogue.ts.
 *
 * If Claude calls lookup_client first, we run the search, append the
 * tool_result, and re-invoke Claude so it can produce the spoken response
 * informed by the lookup data.
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export const INBOUND_GREETING =
  "Hi, you've reached Hudson Valley Homecare. This is Aria, the automated assistant. Who am I speaking with?";

export interface InboundTurnInput {
  transcript: DialogueTurn[];
  /** Tracked across turns by the session so the prompt stays accurate. */
  callerIdentityProvided: boolean;
  lookedUpPatientName: string | null;
}

export interface InboundTurnOutput {
  spokenResponse: string;
  callerProvidedIdentity: boolean;
  callerIdentityText?: string;
  callerAskedAboutClient: boolean;
  endCall: boolean;
  escalate: boolean;
  /** Populated when Claude called lookup_client on this turn. */
  lookupQuery?: string;
  lookedUpClient?: Client | null;
}

const LOOKUP_CLIENT_TOOL: Anthropic.Tool = {
  name: "lookup_client",
  description:
    "Look up a homecare patient record by name OR member ID. Call this once the caller has provided either a patient name or member ID with enough confidence.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Patient name or member ID exactly as the caller said it",
      },
    },
    required: ["query"],
  },
};

const SUBMIT_TURN_TOOL: Anthropic.Tool = {
  name: "submit_turn",
  description:
    "Submit the agent's response for this turn. Call this when you are ready to speak back to the caller and do NOT need to look anything up.",
  input_schema: {
    type: "object",
    properties: {
      spoken_response: {
        type: "string",
        description:
          "What Aria says next, in natural conversational English. 1-2 sentences max. No stage directions, no markdown.",
      },
      caller_provided_identity: {
        type: "boolean",
        description:
          "True if the caller has identified themselves (name + payer organization) at any point in the conversation so far.",
      },
      caller_identity: {
        type: "string",
        description:
          "If the caller provided identity on THIS turn, the short text (e.g. 'Sarah from Aetna'). Omit otherwise.",
      },
      caller_asked_about_client: {
        type: "boolean",
        description:
          "True if the caller has named a specific patient or member ID at any point in the conversation so far.",
      },
      end_call: {
        type: "boolean",
        description:
          "True if the call is wrapping up (caller said goodbye, refused identity, or you have finished reading the record and they have no more questions).",
      },
      escalate: {
        type: "boolean",
        description:
          "True if the caller asked for something out of scope (live human, billing details, anything Aria shouldn't answer).",
      },
    },
    required: [
      "spoken_response",
      "caller_provided_identity",
      "caller_asked_about_client",
      "end_call",
      "escalate",
    ],
  },
};

function buildSystemPrompt(input: InboundTurnInput): string {
  const identityLine = input.callerIdentityProvided ? "true" : "false";
  const patientLine = input.lookedUpPatientName ?? "none yet";
  const today = new Date().toISOString().slice(0, 10);

  return `You are an automated assistant answering the phone at Hudson Valley Homecare, a home health practice. A caller has just dialed in. They will typically be a representative from a health insurance payer (Aetna, BCBS, UHC) calling to check on a patient under our care.

Your job:
  1. Greet the caller and ask who they are (their name, payer organization)
  2. Once they identify themselves, ask which patient they're calling about
  3. Look up the patient with the lookup_client tool (by name or member ID)
  4. Read back the relevant authorization, visit, and care details from the record
  5. Answer follow-ups, then wrap up the call politely

Hard rules:
  - You MUST ask for the caller's identity before sharing any patient info. If they refuse, politely end the call.
  - You speak in 1-2 sentence turns. Never monologue.
  - You only have records for patients in our system. If lookup returns null, say "I don't have a record for that patient — could you spell the name?" and ask again. After 2 failed lookups, offer to take a message and end the call.
  - Never invent data. Only read back fields that exist in the lookup result.
  - Never disclose patient info without the caller naming the patient first.
  - This is a demo — when reading dates, use natural speech ("April fifteenth, nineteen fifty-two" not "1952-04-15").

Tool choice:
  - Call lookup_client when (and only when) the caller has given you a patient name or member ID and you do not already have that patient's record loaded.
  - Otherwise call submit_turn to speak.

Current call state:
  - Caller identity provided: ${identityLine}
  - Patient looked up: ${patientLine}
  - Today's date: ${today}

(Conversation history follows as user/assistant turns.)`;
}

function buildMessages(transcript: DialogueTurn[]): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = [];
  for (const turn of transcript) {
    msgs.push({
      role: turn.role === "agent" ? "assistant" : "user",
      content: turn.text,
    });
  }
  // First user turn — caller has dialed in but hasn't spoken yet. Aria
  // already greeted via the TwiML welcomeGreeting. We synthesize an
  // initial user message so Claude has something to respond to.
  if (msgs.length === 0 || msgs[msgs.length - 1].role === "assistant") {
    msgs.push({
      role: "user",
      content: "[Caller is silent — re-prompt them politely.]",
    });
  }
  return msgs;
}

function formatLookupResult(client: Client | null, query: string): string {
  if (!client) {
    return JSON.stringify({ found: false, query });
  }
  return JSON.stringify({
    found: true,
    query,
    record: {
      patient_name: client.patient_name,
      date_of_birth: client.date_of_birth,
      member_id: client.member_id,
      payer_id: client.payer_id,
      service_authorized: client.service_authorized,
      auth_period_start: client.auth_period_start,
      auth_period_end: client.auth_period_end,
      authorization_status: client.authorization_status,
      last_visit_date: client.last_visit_date,
      next_visit_scheduled: client.next_visit_scheduled,
      care_notes: client.care_notes,
    },
  });
}

interface SubmitTurnArgs {
  spoken_response: string;
  caller_provided_identity: boolean;
  caller_identity?: string;
  caller_asked_about_client: boolean;
  end_call: boolean;
  escalate: boolean;
}

function parseSubmitTurn(block: Anthropic.ToolUseBlock): SubmitTurnArgs {
  return block.input as SubmitTurnArgs;
}

export async function runTurn(input: InboundTurnInput): Promise<InboundTurnOutput> {
  const systemPrompt = buildSystemPrompt(input);
  const messages = buildMessages(input.transcript);

  const firstResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    tools: [LOOKUP_CLIENT_TOOL, SUBMIT_TURN_TOOL],
    tool_choice: { type: "any" },
    messages,
  });

  const toolUse = firstResponse.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `Claude returned no tool_use. Blocks: ${firstResponse.content.map((b) => b.type).join(",")}`,
    );
  }

  // Direct submit_turn — return immediately.
  if (toolUse.name === "submit_turn") {
    const args = parseSubmitTurn(toolUse);
    return {
      spokenResponse: args.spoken_response,
      callerProvidedIdentity: args.caller_provided_identity,
      callerIdentityText: args.caller_identity,
      callerAskedAboutClient: args.caller_asked_about_client,
      endCall: args.end_call || args.escalate,
      escalate: args.escalate,
    };
  }

  // lookup_client — resolve, feed back, ask Claude to speak.
  if (toolUse.name === "lookup_client") {
    const lookupInput = toolUse.input as { query: string };
    const query = (lookupInput.query ?? "").toString();
    const found = findClientByQuery(query);
    const toolResultContent = formatLookupResult(found, query);

    // Build follow-up message chain — assistant's tool_use, then our tool_result.
    const followupMessages: Anthropic.MessageParam[] = [
      ...messages,
      { role: "assistant", content: firstResponse.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: toolResultContent,
          },
        ],
      },
    ];

    const secondResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: [LOOKUP_CLIENT_TOOL, SUBMIT_TURN_TOOL],
      tool_choice: { type: "tool", name: "submit_turn" },
      messages: followupMessages,
    });

    const finalTool = secondResponse.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "submit_turn",
    );
    if (!finalTool) {
      throw new Error("Claude did not call submit_turn after lookup_client");
    }
    const args = parseSubmitTurn(finalTool);

    return {
      spokenResponse: args.spoken_response,
      callerProvidedIdentity: args.caller_provided_identity,
      callerIdentityText: args.caller_identity,
      callerAskedAboutClient: args.caller_asked_about_client,
      endCall: args.end_call || args.escalate,
      escalate: args.escalate,
      lookupQuery: query,
      lookedUpClient: found,
    };
  }

  throw new Error(`Unexpected tool: ${toolUse.name}`);
}
