/**
 * Call FSM — 7 bounded states.
 *
 * Matches slide 6 of the deck: Dial → Navigate IVR → Hold → Identify →
 * Ask → Handle pushback → Extract → Write back.
 *
 * Why a state machine and not just "let the LLM figure it out":
 *   - Hard guarantees: the agent CANNOT make commitments it shouldn't
 *     (no "yes we'll send you that today" answers).
 *   - Bounded prompts per state = smaller context = lower latency.
 *   - Evals can target a specific state ("did we identify correctly?").
 *
 * This is the same FSM pattern shipped in the MIA Clinical Intake module
 * (7-state, 82/82 tests passing — referenced on slide 9).
 */

export type CallState =
  | "GREET" //  Agent has just connected, hasn't spoken yet
  | "IDENTIFY" //  Stating who we are, NPI, application #
  | "IVR_NAV" //  Pressing DTMF for menus
  | "HOLD" //  Waiting on hold music
  | "ASK" //  Slot-filling questions
  | "CLARIFY" //  Caught a "could you repeat" — re-ask the last slot
  | "CLOSE"; //  Wrapping up, getting reference number

export interface FSMContext {
  state: CallState;
  /** Which slot we are currently trying to fill (only meaningful in ASK/CLARIFY). */
  pendingSlot: string | null;
  /** Number of times we've re-asked the current slot. After 2 retries, we move on. */
  retryCount: number;
  /** Was the last turn an interrupt? */
  lastWasInterrupt: boolean;
  /** Number of consecutive hold-music indicators. After N, we give up. */
  holdTicks: number;
}

export const initialContext = (): FSMContext => ({
  state: "GREET",
  pendingSlot: null,
  retryCount: 0,
  lastWasInterrupt: false,
  holdTicks: 0,
});

/**
 * Pure transition function. Given the current state and a transcript +
 * structured signals from Claude, returns the next state.
 *
 * This is deterministic: the LLM proposes the *content* of what to say,
 * but the FSM decides *whether* a state transition is allowed.
 */
export interface TransitionInput {
  ctx: FSMContext;
  /** What the caller (or payer rep) just said. */
  lastUtterance: string;
  /** Did Claude judge that the current slot was successfully answered? */
  slotResolved: boolean;
  /** Did the rep ask us to repeat? */
  clarificationRequested: boolean;
  /** Are we hearing hold music? */
  onHold: boolean;
  /** Did the rep say something we should escalate (e.g. "I need authorization")? */
  shouldEscalate: boolean;
  /** Are all required slots filled? */
  allSlotsFilled: boolean;
}

export function transition(input: TransitionInput): FSMContext {
  const { ctx, slotResolved, clarificationRequested, onHold, allSlotsFilled } =
    input;
  const next: FSMContext = { ...ctx };

  // Hold detection short-circuits state transitions.
  if (onHold) {
    next.state = "HOLD";
    next.holdTicks = ctx.holdTicks + 1;
    return next;
  }

  // Coming off hold — go back to whatever we were doing.
  if (ctx.state === "HOLD" && !onHold) {
    next.state = ctx.pendingSlot ? "ASK" : "IDENTIFY";
    next.holdTicks = 0;
    return next;
  }

  switch (ctx.state) {
    case "GREET":
      // After the welcome line plays, immediately move to identifying ourselves.
      next.state = "IDENTIFY";
      break;

    case "IDENTIFY":
      // Once the rep acknowledges us (or asks a question), start slot-filling.
      next.state = "ASK";
      next.pendingSlot = "application_status";
      break;

    case "IVR_NAV":
      // After DTMF navigation completes, we expect to hear a rep or hold music.
      next.state = "IDENTIFY";
      break;

    case "ASK":
      if (clarificationRequested) {
        next.state = "CLARIFY";
        next.retryCount = ctx.retryCount + 1;
      } else if (slotResolved) {
        next.retryCount = 0;
        if (allSlotsFilled) {
          next.state = "CLOSE";
          next.pendingSlot = "reference_number";
        } else {
          // Move to the next slot — dialogue policy picks which one.
          next.state = "ASK";
        }
      }
      break;

    case "CLARIFY":
      // Give the rep one more chance; if they answer, go back to ASK.
      if (slotResolved) {
        next.state = "ASK";
        next.retryCount = 0;
      } else if (ctx.retryCount >= 2) {
        // Two clarifications and still nothing — skip this slot, mark "unknown".
        next.state = "ASK";
        next.retryCount = 0;
      }
      break;

    case "CLOSE":
      // Terminal — dialogue.ts sees state=CLOSE and emits the end-session message.
      break;
  }

  return next;
}

/**
 * Human-readable label for the live transcript UI.
 */
export const stateLabel: Record<CallState, string> = {
  GREET: "Greeting",
  IDENTIFY: "Identifying",
  IVR_NAV: "Navigating IVR",
  HOLD: "On hold",
  ASK: "Asking question",
  CLARIFY: "Re-asking",
  CLOSE: "Wrapping up",
};
