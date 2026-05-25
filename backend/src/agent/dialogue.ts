import Anthropic from "@anthropic-ai/sdk";
import { CallState, FSMContext, stateLabel } from "./fsm.js";
import { Playbook, PlaybookSlot, hydrate } from "./playbook.js";
import { CallSlots, PartialCallSlots } from "./slots.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

/**
 * One agent turn = one call to Claude.
 *
 * Inputs:  current FSM state, conversation transcript, slots filled so far,
 *          playbook for this payer.
 * Outputs: what the agent should SAY (streamed back to Twilio as text tokens),
 *          updated slots (if Claude extracted anything from the rep's reply),
 *          structured signals the FSM needs (slotResolved, clarificationRequested,
 *          shouldEscalate).
 *
 * We use a tool-use approach: Claude calls `submit_turn` with both the
 * spoken response and the structured analysis. This is the same
 * schema-constrained pattern from MIA document extraction (slide 9).
 */

export interface DialogueTurn {
  role: "agent" | "rep";
  text: string;
  state: CallState;
  ts: number;
}

export interface AgentTurnInput {
  ctx: FSMContext;
  playbook: Playbook;
  transcript: DialogueTurn[];
  slots: PartialCallSlots;
  /** Hydration context — the call's metadata that {placeholders} get filled with. */
  callContext: {
    npi: string;
    application_id: string;
    provider_name: string;
  };
}

export interface AgentTurnOutput {
  spokenResponse: string;
  updatedSlots: PartialCallSlots;
  slotResolved: boolean;
  clarificationRequested: boolean;
  shouldEscalate: boolean;
  allSlotsFilled: boolean;
  /** If true, dialogue.ts will emit an end-session message to Twilio. */
  endCall: boolean;
}

/**
 * The submit_turn tool schema. Claude MUST call this exactly once per
 * turn, with all fields populated. That's how we get structured output
 * with the same reliability the deck promised on slide 6.
 */
const SUBMIT_TURN_TOOL: Anthropic.Tool = {
  name: "submit_turn",
  description:
    "Submit the agent's response for this turn. You MUST call this exactly once. Include both the spoken response (what the agent says next) and structured analysis of the rep's last utterance.",
  input_schema: {
    type: "object",
    properties: {
      spoken_response: {
        type: "string",
        description:
          "What the agent should say next, in natural conversational English. 1-2 sentences max — long agent monologues are a tell. Do NOT include stage directions or markdown.",
      },
      updated_slots: {
        type: "object",
        description:
          "Slots you extracted from the rep's MOST RECENT utterance. Only include slots that the rep actually answered in their last turn. Use null for slots the rep refused or could not answer.",
        properties: {
          application_status: {
            type: "string",
            enum: [
              "in_review",
              "missing_info",
              "approved",
              "denied",
              "pending_committee",
              "not_found",
              "unknown",
            ],
          },
          missing_items: { type: "array", items: { type: "string" } },
          expected_decision_date: {
            type: "string",
            description: "ISO date YYYY-MM-DD or null",
          },
          reference_number: { type: "string" },
          rep_name: { type: "string" },
          notes: { type: "string" },
        },
      },
      slot_resolved: {
        type: "boolean",
        description:
          "True if the rep's last utterance successfully answered the slot you were asking about.",
      },
      clarification_requested: {
        type: "boolean",
        description:
          "True if the rep asked us to repeat, didn't catch what we said, or asked for clarification.",
      },
      should_escalate: {
        type: "boolean",
        description:
          "True if the rep said something requiring human escalation — e.g. asked for authorization documents, mentioned a fraud flag, refused to speak with us.",
      },
      end_call: {
        type: "boolean",
        description:
          "True only if you are in the CLOSE state and have received a reference number, OR escalation is required.",
      },
    },
    required: [
      "spoken_response",
      "updated_slots",
      "slot_resolved",
      "clarification_requested",
      "should_escalate",
      "end_call",
    ],
  },
};

function buildSystemPrompt(
  ctx: FSMContext,
  playbook: Playbook,
  slots: PartialCallSlots,
  callContext: AgentTurnInput["callContext"],
): string {
  const filledSlots = Object.entries(slots)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `  - ${k}: ${JSON.stringify(v)}`)
    .join("\n") || "  (none yet)";

  const remainingSlots = playbook.slots
    .filter((s) => {
      const cur = (slots as Record<string, unknown>)[s.name];
      return cur === null || cur === undefined || (Array.isArray(cur) && cur.length === 0);
    })
    .map((s) => `  - ${s.name} (${s.type}): "${s.question}"`)
    .join("\n") || "  (all filled)";

  const guardrailLines = playbook.guardrails.map((g) => `  - ${g.replace(/_/g, " ")}`).join("\n");

  return `You are an outbound voice agent placing a call to ${playbook.payer} on behalf of ${playbook.persona.practice_name}.

Your job: get a structured status update on a provider credentialing application. You speak naturally and briefly — like a busy credentialing coordinator, not a chatbot. One question per turn. Never more than two sentences.

# Current call state
State: ${ctx.state} (${stateLabel[ctx.state]})
Currently asking about slot: ${ctx.pendingSlot ?? "(none)"}
Retry count on this slot: ${ctx.retryCount}

# Slots already filled
${filledSlots}

# Slots still needed
${remainingSlots}

# Hard rules (NEVER violate these)
${guardrailLines}

# Call metadata
NPI: ${callContext.npi}
Application ID: ${callContext.application_id}
Provider name: ${callContext.provider_name}

# How to behave per state
- GREET: You haven't spoken yet. Open with the playbook greeting verbatim.
- IDENTIFY: Briefly confirm who you are and what you're calling about. ONE sentence.
- ASK: Ask the next slot question. Use the playbook wording loosely; sound natural.
- CLARIFY: Re-ask the same slot more simply. After 2 retries, mark slot as unknown and move on (set slot_resolved=true with the value "unknown").
- HOLD: Say nothing — return empty spoken_response. The FSM handles hold.
- CLOSE: Ask for the reference number, thank the rep, then set end_call=true.

# Extraction rules
- Only update slots from what the REP just said, not from your own questions.
- Map free-text status descriptions to the enum: "still being reviewed" → in_review, "we need more docs" → missing_info, "approved" → approved, "denied/rejected" → denied, "with the committee" → pending_committee, "can't find it" → not_found.
- Dates: convert "two weeks" → ISO date relative to today (${new Date().toISOString().slice(0, 10)}).
- If rep says they need to escalate, get authorization, or refuses — set should_escalate=true.

Greeting (use verbatim only on first turn): "${hydrate(playbook.script.greeting, { ...playbook.persona, ...callContext }).replace(/\n/g, " ").trim()}"

Now call the submit_turn tool with your response and analysis.`;
}

function buildMessages(
  transcript: DialogueTurn[],
): Anthropic.MessageParam[] {
  // We map the conversation into Anthropic messages format.
  // Agent turns = "assistant", rep turns = "user".
  const msgs: Anthropic.MessageParam[] = [];
  for (const turn of transcript) {
    msgs.push({
      role: turn.role === "agent" ? "assistant" : "user",
      content: turn.text,
    });
  }
  // The very first turn has no rep input yet — Claude needs *something*
  // as the user message to start the conversation.
  if (msgs.length === 0 || msgs[msgs.length - 1].role === "assistant") {
    msgs.push({
      role: "user",
      content: "[Call connected. The rep just answered: 'Provider services, this is Sarah, how can I help you?']",
    });
  }
  return msgs;
}

/**
 * Run one agent turn. Returns what to say + structured analysis.
 */
export async function runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const { ctx, playbook, transcript, slots, callContext } = input;

  const systemPrompt = buildSystemPrompt(ctx, playbook, slots, callContext);
  const messages = buildMessages(transcript);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    tools: [SUBMIT_TURN_TOOL],
    tool_choice: { type: "tool", name: "submit_turn" },
    messages,
  });

  // Find the tool_use block. There should be exactly one because we forced it.
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Claude did not call submit_turn. Got blocks: ${response.content.map((b) => b.type).join(", ")}`,
    );
  }

  const args = toolUse.input as {
    spoken_response: string;
    updated_slots: Record<string, unknown>;
    slot_resolved: boolean;
    clarification_requested: boolean;
    should_escalate: boolean;
    end_call: boolean;
  };

  // Merge slot updates — only override fields Claude actually set.
  const updatedSlots: PartialCallSlots = { ...slots };
  for (const [k, v] of Object.entries(args.updated_slots ?? {})) {
    if (v !== undefined && v !== null && v !== "") {
      (updatedSlots as Record<string, unknown>)[k] = v;
    }
  }

  // Check if everything required is filled.
  const requiredSlots = playbook.slots.filter((s) => s.required);
  const allSlotsFilled = requiredSlots.every((s) => {
    const v = (updatedSlots as Record<string, unknown>)[s.name];
    return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  });

  return {
    spokenResponse: args.spoken_response,
    updatedSlots,
    slotResolved: args.slot_resolved,
    clarificationRequested: args.clarification_requested,
    shouldEscalate: args.should_escalate,
    allSlotsFilled,
    endCall: args.end_call || args.should_escalate,
  };
}
