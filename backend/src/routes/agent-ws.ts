import { WebSocket, WebSocketServer } from "ws";
import { Server as HttpServer } from "node:http";
import { Playbook } from "../agent/playbook.js";
import {
  DialogueTurn,
  runTurn,
} from "../agent/dialogue.js";
import {
  runTurn as runInboundTurn,
  INBOUND_GREETING,
} from "../agent/inbound-dialogue.js";
import {
  CallState,
  FSMContext,
  initialContext,
  transition,
} from "../agent/fsm.js";
import { PartialCallSlots, emptySlots } from "../agent/slots.js";
import {
  appendTurn,
  finishCall,
  getCall,
  setCallerIdentity,
  setLookedUpClient,
  updateSlots,
} from "../store/db.js";
import { liveBus } from "../store/livebus.js";

/**
 * Per-call session state. Lives in memory while the call is active.
 * Tied to a single WebSocket connection from Twilio's ConversationRelay.
 */
interface Session {
  callId: string;
  /** Dialogue mode — picks which runTurn handles each prompt. */
  mode: "outbound" | "inbound_lookup";
  /** Playbook is only meaningful for outbound mode. */
  playbook: Playbook | null;
  ctx: FSMContext;
  transcript: DialogueTurn[];
  slots: PartialCallSlots;
  callContext: { npi: string; application_id: string; provider_name: string };
  twilioWs: WebSocket;
  /** Lock to prevent concurrent Claude turns from the same call. */
  turnInProgress: boolean;
  // Inbound-only running state — carried into the prompt each turn so
  // Aria knows what she's already established.
  callerIdentityProvided: boolean;
  lookedUpPatientName: string | null;
}

/**
 * Attach the ConversationRelay WebSocket handler to the same HTTP server
 * Express runs on. Twilio connects here when our TwiML opens the relay.
 */
export function attachAgentWebSocket(
  server: HttpServer,
  playbooks: Record<string, Playbook>,
): void {
  const wss = new WebSocketServer({ server, path: "/agent-ws" });

  wss.on("connection", (ws) => {
    console.log("[ws:agent] Twilio connected");
    let session: Session | null = null;

    ws.on("message", async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        console.warn("[ws:agent] non-JSON message:", raw.toString().slice(0, 200));
        return;
      }

      const type = msg.type as string;

      try {
        switch (type) {
          case "setup":
            session = await handleSetup(msg, ws, playbooks);
            // GREET state plays the welcomeGreeting attribute from TwiML —
            // we don't send any text tokens yet. The first prompt message
            // from the caller/rep triggers the first runTurn.
            if (session) {
              const greetingText =
                session.mode === "inbound_lookup"
                  ? INBOUND_GREETING
                  : buildHydratedGreeting(session);
              recordAgentTurn(session, greetingText, "GREET");
            }
            break;

          case "prompt":
            if (!session) {
              console.warn("[ws:agent] prompt before setup");
              return;
            }
            if (session.mode === "inbound_lookup") {
              await handleInboundPrompt(msg, session, ws);
            } else {
              await handlePrompt(msg, session, ws);
            }
            break;

          case "interrupt":
            if (session) {
              session.ctx.lastWasInterrupt = true;
              console.log(
                `[ws:agent] interrupted after ${msg.durationUntilInterruptMs}ms`,
              );
            }
            break;

          case "dtmf":
            console.log(`[ws:agent] caller pressed ${msg.digit}`);
            break;

          case "error":
            console.error("[ws:agent] Twilio error:", msg.description);
            break;
        }
      } catch (err) {
        console.error("[ws:agent] handler error:", err);
      }
    });

    ws.on("close", () => {
      console.log("[ws:agent] Twilio disconnected");
      if (session) {
        // Inbound doesn't use the outbound FSM, so we mark inbound calls
        // completed on a clean disconnect regardless of FSM state.
        const completed =
          session.mode === "inbound_lookup"
            ? true
            : session.ctx.state === "CLOSE";
        finishCall({
          callId: session.callId,
          status: completed ? "completed" : "failed",
          finalState: session.ctx.state,
        });
        liveBus.publish({
          type: "call_ended",
          call_id: session.callId,
          status: completed ? "completed" : "failed",
          ended_at: Date.now(),
        });
      }
    });

    ws.on("error", (err) => {
      console.error("[ws:agent] socket error:", err);
    });
  });

  console.log("[ws:agent] WebSocket server listening on /agent-ws");
}

async function handleSetup(
  msg: Record<string, unknown>,
  ws: WebSocket,
  playbooks: Record<string, Playbook>,
): Promise<Session | null> {
  const params = (msg.customParameters as Record<string, string>) || {};
  const callId = params.call_id;
  const playbookId = params.playbook_id;
  const mode = (params.mode as "outbound" | "inbound_lookup") || "outbound";

  if (!callId) {
    console.error("[ws:agent] setup missing call_id", params);
    ws.close();
    return null;
  }

  const callRecord = getCall(callId);
  if (!callRecord) {
    console.error(`[ws:agent] no call record for ${callId}`);
    ws.close();
    return null;
  }

  // Inbound lookup mode — no playbook required; Aria handles it directly.
  if (mode === "inbound_lookup") {
    console.log(
      `[ws:agent] setup OK (inbound_lookup) — call=${callId} dir=${callRecord.direction}`,
    );
    return {
      callId,
      mode,
      playbook: null,
      ctx: initialContext(),
      transcript: [],
      slots: emptySlots(),
      callContext: {
        npi: callRecord.npi,
        application_id: callRecord.application_id,
        provider_name: callRecord.provider_name,
      },
      twilioWs: ws,
      turnInProgress: false,
      callerIdentityProvided: false,
      lookedUpPatientName: null,
    };
  }

  // Outbound mode — must have a valid playbook.
  if (!playbookId) {
    console.error("[ws:agent] setup missing playbook_id for outbound", params);
    ws.close();
    return null;
  }
  const playbook = playbooks[playbookId];
  if (!playbook) {
    console.error(`[ws:agent] unknown playbook ${playbookId}`);
    ws.close();
    return null;
  }

  console.log(
    `[ws:agent] setup OK — call=${callId} payer=${playbook.payer} dir=${callRecord.direction}`,
  );

  return {
    callId,
    mode: "outbound",
    playbook,
    ctx: initialContext(),
    transcript: [],
    slots: emptySlots(),
    callContext: {
      npi: callRecord.npi,
      application_id: callRecord.application_id,
      provider_name: callRecord.provider_name,
    },
    twilioWs: ws,
    turnInProgress: false,
    callerIdentityProvided: false,
    lookedUpPatientName: null,
  };
}

async function handlePrompt(
  msg: Record<string, unknown>,
  session: Session,
  ws: WebSocket,
): Promise<void> {
  const text = (msg.voicePrompt as string) || "";
  const isFinal = msg.last as boolean;

  // We only process FINAL turns. Partial transcripts would just thrash
  // the LLM and produce stuttering responses.
  if (!isFinal || !text.trim()) return;

  // Prevent concurrent turns on the same call.
  if (session.turnInProgress) {
    console.log("[ws:agent] turn already in progress, dropping prompt");
    return;
  }
  session.turnInProgress = true;

  try {
    if (!session.playbook) {
      console.error("[ws:agent] outbound prompt with no playbook on session");
      return;
    }
    // Record what the rep said.
    recordRepTurn(session, text);

    // Run one Claude turn.
    const result = await runTurn({
      ctx: session.ctx,
      playbook: session.playbook,
      transcript: session.transcript,
      slots: session.slots,
      callContext: session.callContext,
    });

    // Update slots in memory + DB + live bus.
    session.slots = result.updatedSlots;
    updateSlots(session.callId, session.slots);
    liveBus.publish({
      type: "slots_updated",
      call_id: session.callId,
      slots: session.slots,
    });

    // Transition the FSM.
    const prevState = session.ctx.state;
    session.ctx = transition({
      ctx: session.ctx,
      lastUtterance: text,
      slotResolved: result.slotResolved,
      clarificationRequested: result.clarificationRequested,
      onHold: false, // Hold detection lives in voice layer; not modeled in MVP.
      shouldEscalate: result.shouldEscalate,
      allSlotsFilled: result.allSlotsFilled,
    });
    if (session.ctx.state !== prevState) {
      liveBus.publish({
        type: "state_changed",
        call_id: session.callId,
        state: session.ctx.state,
      });
    }

    // Send the spoken response to Twilio (TTS).
    if (result.spokenResponse.trim()) {
      sendTextToken(ws, result.spokenResponse, true);
      recordAgentTurn(session, result.spokenResponse, session.ctx.state);
    }

    // End the call if Claude says so.
    if (result.endCall) {
      console.log(
        `[ws:agent] ending call ${session.callId} (escalate=${result.shouldEscalate})`,
      );
      // Give TTS a moment to play, then end.
      setTimeout(() => {
        sendEndSession(ws, {
          reasonCode: result.shouldEscalate ? "escalation" : "completed",
          callId: session.callId,
        });
      }, 1500);
    }
  } catch (err) {
    console.error("[ws:agent] turn failed:", err);
    sendTextToken(
      ws,
      "I'm sorry, I'm having a technical issue. Let me have a colleague follow up.",
      true,
    );
    setTimeout(() => sendEndSession(ws, { reasonCode: "error" }), 1500);
  } finally {
    session.turnInProgress = false;
  }
}

async function handleInboundPrompt(
  msg: Record<string, unknown>,
  session: Session,
  ws: WebSocket,
): Promise<void> {
  const text = (msg.voicePrompt as string) || "";
  const isFinal = msg.last as boolean;

  if (!isFinal || !text.trim()) return;
  if (session.turnInProgress) {
    console.log("[ws:agent] inbound turn already in progress, dropping prompt");
    return;
  }
  session.turnInProgress = true;

  try {
    recordRepTurn(session, text);

    const result = await runInboundTurn({
      transcript: session.transcript,
      callerIdentityProvided: session.callerIdentityProvided,
      lookedUpPatientName: session.lookedUpPatientName,
    });

    // Carry identity / lookup state forward into the next turn's prompt.
    if (result.callerProvidedIdentity) {
      session.callerIdentityProvided = true;
    }
    if (result.callerIdentityText && result.callerIdentityText.trim()) {
      setCallerIdentity(session.callId, result.callerIdentityText.trim());
    }

    if (result.lookedUpClient) {
      session.lookedUpPatientName = result.lookedUpClient.patient_name;
      setLookedUpClient(session.callId, result.lookedUpClient.id);
      liveBus.publish({
        type: "client_looked_up",
        call_id: session.callId,
        client_id: result.lookedUpClient.id,
      });
    }

    if (result.spokenResponse.trim()) {
      sendTextToken(ws, result.spokenResponse, true);
      // For inbound we don't run the outbound FSM — use a stable state
      // label so the transcript schema stays compatible.
      recordAgentTurn(session, result.spokenResponse, "ASK");
    }

    if (result.endCall) {
      console.log(
        `[ws:agent] ending inbound call ${session.callId} (escalate=${result.escalate})`,
      );
      setTimeout(() => {
        sendEndSession(ws, {
          reasonCode: result.escalate ? "escalation" : "completed",
          callId: session.callId,
        });
      }, 1500);
    }
  } catch (err) {
    console.error("[ws:agent] inbound turn failed:", err);
    sendTextToken(
      ws,
      "I'm sorry, I'm having a technical issue. Could you call back in a moment?",
      true,
    );
    setTimeout(() => sendEndSession(ws, { reasonCode: "error" }), 1500);
  } finally {
    session.turnInProgress = false;
  }
}

function sendTextToken(ws: WebSocket, token: string, last: boolean): void {
  ws.send(
    JSON.stringify({
      type: "text",
      token,
      last,
      interruptible: true,
      preemptible: false,
    }),
  );
}

function sendEndSession(
  ws: WebSocket,
  handoffData: Record<string, unknown>,
): void {
  ws.send(
    JSON.stringify({
      type: "end",
      handoffData: JSON.stringify(handoffData),
    }),
  );
}

function recordRepTurn(session: Session, text: string): void {
  const turn: DialogueTurn = {
    role: "rep",
    text,
    state: session.ctx.state,
    ts: Date.now(),
  };
  session.transcript.push(turn);
  appendTurn(session.callId, turn);
  liveBus.publish({
    type: "transcript_turn",
    call_id: session.callId,
    role: "rep",
    text,
    state: session.ctx.state,
    ts: turn.ts,
  });
}

function recordAgentTurn(session: Session, text: string, state: CallState): void {
  const turn: DialogueTurn = {
    role: "agent",
    text,
    state,
    ts: Date.now(),
  };
  session.transcript.push(turn);
  appendTurn(session.callId, turn);
  liveBus.publish({
    type: "transcript_turn",
    call_id: session.callId,
    role: "agent",
    text,
    state,
    ts: turn.ts,
  });
}

function buildHydratedGreeting(session: Session): string {
  // The greeting was already spoken via TwiML welcomeGreeting attribute,
  // so this is just for our own transcript log.
  const { playbook, callContext } = session;
  if (!playbook) return "";
  let g = playbook.script.greeting;
  g = g
    .replace(/\{caller_name\}/g, playbook.persona.caller_name)
    .replace(/\{practice_name\}/g, playbook.persona.practice_name)
    .replace(/\{practice_tax_id\}/g, playbook.persona.practice_tax_id)
    .replace(/\{npi\}/g, callContext.npi)
    .replace(/\{application_id\}/g, callContext.application_id)
    .replace(/\{provider_name\}/g, callContext.provider_name);
  return g.replace(/\n/g, " ").trim();
}
