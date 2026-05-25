import { z } from "zod";

/**
 * Structured slot schema for one payer-status follow-up call.
 *
 * This is the contract the deck promised on slide 6:
 *   "Extract: Call → Pydantic schema. Same engine MIA uses for docs."
 *
 * Every field is intentionally bounded — enums where possible, dates as
 * ISO strings, free-text only for rep_name and notes. This is what gets
 * written to the dashboard at the end of each call.
 */
export const ApplicationStatusEnum = z.enum([
  "in_review",
  "missing_info",
  "approved",
  "denied",
  "pending_committee",
  "not_found",
  "unknown",
]);

export type ApplicationStatus = z.infer<typeof ApplicationStatusEnum>;

export const CallSlotsSchema = z.object({
  application_status: ApplicationStatusEnum.describe(
    "The current status of the application, normalized from rep speech.",
  ),
  missing_items: z
    .array(z.string())
    .default([])
    .describe(
      "List of documents or pieces of information the payer is still waiting on. Empty list if none.",
    ),
  expected_decision_date: z
    .string()
    .nullable()
    .describe(
      "ISO date (YYYY-MM-DD) when payer expects a decision. Null if rep would not commit.",
    ),
  reference_number: z
    .string()
    .nullable()
    .describe(
      "Reference / confirmation number for this call. Null if rep did not provide one.",
    ),
  rep_name: z
    .string()
    .nullable()
    .describe("Name of the payer representative we spoke with."),
  notes: z
    .string()
    .nullable()
    .describe(
      "Any pushback, anomaly, or context the coordinator needs to know. Keep < 200 chars.",
    ),
});

export type CallSlots = z.infer<typeof CallSlotsSchema>;

/**
 * Partial slots — what we have so far mid-call. Frontend renders this
 * live and fills cells in as confidence rises.
 */
export const PartialCallSlotsSchema = CallSlotsSchema.partial();
export type PartialCallSlots = z.infer<typeof PartialCallSlotsSchema>;

/**
 * Empty slot state — what a call starts with.
 */
export const emptySlots = (): PartialCallSlots => ({
  application_status: undefined,
  missing_items: [],
  expected_decision_date: null,
  reference_number: null,
  rep_name: null,
  notes: null,
});

/**
 * Per-slot accuracy report. Used by the eval harness (slide 12).
 */
export const SlotAccuracyReportSchema = z.object({
  call_id: z.string(),
  slots_filled: z.number(),
  slots_total: z.number(),
  slot_fill_rate: z.number(),
  slots_correct: z.number().nullable(), // null if no ground truth provided
  accuracy: z.number().nullable(),
});

export type SlotAccuracyReport = z.infer<typeof SlotAccuracyReportSchema>;
