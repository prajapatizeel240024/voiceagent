import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

/**
 * Per-payer playbook schema. Every payer YAML file in /playbooks must
 * conform to this. The schema IS the contract for the YAML editor
 * coordinators will get in Phase 5–8 (slide 11).
 */
const SlotSchema = z.object({
  name: z.string(),
  question: z.string(),
  type: z.enum(["enum", "list", "date", "string"]),
  values: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  asked_in_state: z.enum(["ASK", "CLOSE"]).default("ASK"),
  skip_if: z.record(z.array(z.string())).optional(),
});

const IvrEntrySchema = z.object({
  prompt_contains: z.string(),
  action: z.enum(["dtmf", "speak"]),
  value: z.string(),
  timeout_ms: z.number().default(8000),
});

export const PlaybookSchema = z.object({
  payer: z.string(),
  payer_id: z.string(),
  provider_services_number: z.string(),
  persona: z.object({
    practice_name: z.string(),
    practice_tax_id: z.string(),
    caller_name: z.string(),
  }),
  ivr_map: z.array(IvrEntrySchema),
  hold_detection: z.object({
    silence_threshold_seconds: z.number(),
    max_hold_seconds: z.number(),
    re_check_every_seconds: z.number(),
  }),
  script: z.object({
    greeting: z.string(),
  }),
  slots: z.array(SlotSchema),
  guardrails: z.array(z.string()),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
export type PlaybookSlot = z.infer<typeof SlotSchema>;

/**
 * Load all playbooks at startup. Validates each one — fails loud if the
 * YAML is malformed. That's intentional: a broken playbook means the
 * agent would say something embarrassing on a real call.
 */
export function loadAllPlaybooks(
  dir = path.join(__dirname, "..", "..", "playbooks"),
): Record<string, Playbook> {
  const result: Record<string, Playbook> = {};
  if (!fs.existsSync(dir)) {
    console.warn(`[playbook] directory not found: ${dir}`);
    return result;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const parsed = YAML.parse(raw);
    const validated = PlaybookSchema.parse(parsed);
    result[validated.payer_id] = validated;
    console.log(`[playbook] loaded ${validated.payer_id} (${validated.payer})`);
  }
  return result;
}

/**
 * Fill template placeholders like {npi}, {application_id}, {practice_name}
 * in a string with values from a context object.
 *
 * Also supports {foo_digits} which strips non-digit chars from `foo` —
 * useful for tax IDs being entered into IVR DTMF.
 */
export function hydrate(
  template: string,
  ctx: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (key.endsWith("_digits")) {
      const base = key.slice(0, -"_digits".length);
      return (ctx[base] ?? "").replace(/\D/g, "");
    }
    return ctx[key] ?? `{${key}}`;
  });
}
