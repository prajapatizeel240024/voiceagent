/**
 * Eval harness — per-slot accuracy reporting on synthetic call transcripts.
 *
 * Slide 12 of the deck promised: "Eval harness with per-slot accuracy
 * reporting on 5 sample calls." This is that.
 *
 * What it does:
 *   1. Load 5 fixture transcripts (rep dialogue + ground-truth slot values).
 *   2. For each fixture, replay the rep's turns through dialogue.runTurn().
 *   3. Compare the slots Claude extracted to ground truth, per field.
 *   4. Print a table: slot, fill rate, accuracy, total.
 *
 * This is the same evaluation pattern referenced on slide 9
 * (NYU Stern · unsafe-output 78% → 96%) — adversarial-style replay
 * with a held-out fixture set.
 *
 * Usage:
 *   cd backend
 *   npx tsx src/eval/run.ts
 */

import "dotenv/config";
import path from "node:path";
import { loadAllPlaybooks } from "../agent/playbook.js";
import { runTurn, DialogueTurn } from "../agent/dialogue.js";
import { initialContext, transition } from "../agent/fsm.js";
import { CallSlots, PartialCallSlots, emptySlots } from "../agent/slots.js";

interface Fixture {
  name: string;
  payer_id: string;
  call_context: {
    npi: string;
    application_id: string;
    provider_name: string;
  };
  /** What the rep says, turn by turn. Each turn becomes one prompt. */
  rep_turns: string[];
  /** Ground truth — what slots the rep ACTUALLY conveyed. */
  ground_truth: PartialCallSlots;
}

const FIXTURES: Fixture[] = [
  {
    name: "01_clean_in_review",
    payer_id: "aetna",
    call_context: {
      npi: "1234567890",
      application_id: "APP-001",
      provider_name: "Dr. Sarah Chen",
    },
    rep_turns: [
      "Provider services, this is Sarah, how can I help you?",
      "Sure, let me pull that up. Yeah, that application is currently in review with our credentialing committee.",
      "No, everything we need has been received. We're just working through it.",
      "I'd expect a decision in about two weeks.",
      "Yes, your reference number is AET-2026-4471.",
    ],
    ground_truth: {
      application_status: "in_review",
      missing_items: [],
      reference_number: "AET-2026-4471",
      rep_name: "Sarah",
    },
  },
  {
    name: "02_missing_info",
    payer_id: "aetna",
    call_context: {
      npi: "9876543210",
      application_id: "APP-002",
      provider_name: "Dr. James Okafor",
    },
    rep_turns: [
      "Aetna provider services, this is Mike.",
      "One moment. Okay, so we're still missing a few things on that one — we need an updated DEA certificate and the malpractice insurance face sheet.",
      "Once we get those, decision should come within ten business days.",
      "Reference for this call is AET-2026-5582.",
    ],
    ground_truth: {
      application_status: "missing_info",
      missing_items: ["DEA certificate", "malpractice insurance face sheet"],
      reference_number: "AET-2026-5582",
      rep_name: "Mike",
    },
  },
  {
    name: "03_approved",
    payer_id: "bcbs_nj",
    call_context: {
      npi: "5555555555",
      application_id: "APP-003",
      provider_name: "Dr. Priya Patel",
    },
    rep_turns: [
      "Good morning, BCBS provider services, this is Linda.",
      "Let me check. Great news — that application was approved last Tuesday. Effective date is the first of next month.",
      "Reference number BC-NJ-91234.",
    ],
    ground_truth: {
      application_status: "approved",
      missing_items: [],
      reference_number: "BC-NJ-91234",
      rep_name: "Linda",
    },
  },
  {
    name: "04_denied_with_reason",
    payer_id: "bcbs_nj",
    call_context: {
      npi: "1111122222",
      application_id: "APP-004",
      provider_name: "Dr. Marcus Webb",
    },
    rep_turns: [
      "BCBS, this is David, how can I help?",
      "Unfortunately that application was denied. The panel is closed in that specialty in this region.",
      "There's a 90-day waiting period before reapplication.",
      "Reference is BC-NJ-77810.",
    ],
    ground_truth: {
      application_status: "denied",
      reference_number: "BC-NJ-77810",
      rep_name: "David",
    },
  },
  {
    name: "05_clarification_then_status",
    payer_id: "aetna",
    call_context: {
      npi: "7777888899",
      application_id: "APP-005",
      provider_name: "Dr. Aisha Rodriguez",
    },
    rep_turns: [
      "Aetna, this is Tom.",
      "Sorry, could you repeat the NPI?",
      "Got it. That one is with the credentialing committee — should be on next Thursday's agenda.",
      "Reference AET-2026-6612.",
    ],
    ground_truth: {
      application_status: "pending_committee",
      reference_number: "AET-2026-6612",
      rep_name: "Tom",
    },
  },
];

interface SlotResult {
  filled: boolean;
  correct: boolean;
  expected: unknown;
  actual: unknown;
}

interface FixtureResult {
  name: string;
  per_slot: Record<string, SlotResult>;
  fill_rate: number;
  accuracy: number;
}

function compareValue(expected: unknown, actual: unknown): boolean {
  if (expected === undefined || expected === null) {
    return actual === undefined || actual === null;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    // Loose array match: every expected item appears as a substring of
    // some actual item (case-insensitive). Real eval would use embeddings.
    return expected.every((e) =>
      actual.some((a) =>
        String(a).toLowerCase().includes(String(e).toLowerCase()),
      ),
    );
  }
  if (typeof expected === "string" && typeof actual === "string") {
    return actual.toLowerCase().includes(expected.toLowerCase());
  }
  return expected === actual;
}

async function runFixture(
  fixture: Fixture,
  playbooks: Awaited<ReturnType<typeof loadAllPlaybooks>>,
): Promise<FixtureResult> {
  const playbook = playbooks[fixture.payer_id];
  if (!playbook) throw new Error(`Missing playbook ${fixture.payer_id}`);

  let ctx = initialContext();
  let slots: PartialCallSlots = emptySlots();
  const transcript: DialogueTurn[] = [];

  for (const repUtterance of fixture.rep_turns) {
    transcript.push({
      role: "rep",
      text: repUtterance,
      state: ctx.state,
      ts: Date.now(),
    });

    const result = await runTurn({
      ctx,
      playbook,
      transcript,
      slots,
      callContext: fixture.call_context,
    });

    slots = result.updatedSlots;
    transcript.push({
      role: "agent",
      text: result.spokenResponse,
      state: ctx.state,
      ts: Date.now(),
    });
    ctx = transition({
      ctx,
      lastUtterance: repUtterance,
      slotResolved: result.slotResolved,
      clarificationRequested: result.clarificationRequested,
      onHold: false,
      shouldEscalate: result.shouldEscalate,
      allSlotsFilled: result.allSlotsFilled,
    });

    if (result.endCall) break;
  }

  // Score per slot against ground truth.
  const per_slot: Record<string, SlotResult> = {};
  const truthKeys = Object.keys(fixture.ground_truth) as Array<
    keyof PartialCallSlots
  >;
  for (const k of truthKeys) {
    const expected = fixture.ground_truth[k];
    const actual = slots[k];
    const filled =
      actual !== null &&
      actual !== undefined &&
      !(Array.isArray(actual) && actual.length === 0);
    per_slot[k] = {
      filled,
      correct: compareValue(expected, actual),
      expected,
      actual,
    };
  }

  const fillCount = Object.values(per_slot).filter((s) => s.filled).length;
  const correctCount = Object.values(per_slot).filter((s) => s.correct).length;
  return {
    name: fixture.name,
    per_slot,
    fill_rate: fillCount / truthKeys.length,
    accuracy: correctCount / truthKeys.length,
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required.");
    process.exit(1);
  }

  const playbooks = loadAllPlaybooks(
    path.join(__dirname, "..", "..", "playbooks"),
  );

  console.log("\n──────────────────────────────────────────────");
  console.log("  Atano voice agent — eval harness");
  console.log(`  ${FIXTURES.length} fixtures · model ${process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5"}`);
  console.log("──────────────────────────────────────────────\n");

  const results: FixtureResult[] = [];
  for (const fixture of FIXTURES) {
    process.stdout.write(`  Running ${fixture.name} … `);
    const t0 = Date.now();
    try {
      const r = await runFixture(fixture, playbooks);
      const ms = Date.now() - t0;
      const acc = (r.accuracy * 100).toFixed(0);
      const fill = (r.fill_rate * 100).toFixed(0);
      console.log(
        `acc=${acc}%  fill=${fill}%  ${ms}ms`,
      );
      results.push(r);
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
  }

  console.log("\n  ── Per-slot summary ──────────────────────────\n");
  const slotKeys = new Set<string>();
  results.forEach((r) => Object.keys(r.per_slot).forEach((k) => slotKeys.add(k)));

  console.log(
    "  slot                     fill   acc    detail",
  );
  console.log("  ─────────────────────────────────────────────");
  for (const slot of slotKeys) {
    let filled = 0;
    let correct = 0;
    let total = 0;
    for (const r of results) {
      if (slot in r.per_slot) {
        total++;
        if (r.per_slot[slot].filled) filled++;
        if (r.per_slot[slot].correct) correct++;
      }
    }
    const fillPct = ((filled / total) * 100).toFixed(0).padStart(3);
    const accPct = ((correct / total) * 100).toFixed(0).padStart(3);
    console.log(
      `  ${slot.padEnd(24)} ${fillPct}%   ${accPct}%   ${correct}/${total}`,
    );
  }

  const overallAcc =
    results.reduce((sum, r) => sum + r.accuracy, 0) / results.length;
  console.log(
    `\n  Overall slot accuracy: ${(overallAcc * 100).toFixed(1)}%\n`,
  );

  // Detail dump for debugging.
  console.log("  ── Per-fixture detail ────────────────────────\n");
  for (const r of results) {
    console.log(`  ${r.name}`);
    for (const [slot, sr] of Object.entries(r.per_slot)) {
      const mark = sr.correct ? "✓" : "✗";
      console.log(
        `    ${mark} ${slot.padEnd(22)} expected=${JSON.stringify(sr.expected)} actual=${JSON.stringify(sr.actual)}`,
      );
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
