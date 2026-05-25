import fs from "node:fs";
import path from "node:path";
import { DialogueTurn } from "../agent/dialogue.js";
import { PartialCallSlots } from "../agent/slots.js";

/**
 * Local-demo persistence — JSON file store.
 *
 * Why a flat JSON file and not SQLite:
 *   - No native compilation step. Jake clones and runs `npm install` and
 *     it works on any machine. No build toolchain surprises Sunday night.
 *   - Volume is tiny (a few calls per demo). Flat-file is fine.
 *   - Same shape we'd write into Firestore in production (one doc per call
 *     + transcript subarray).
 *
 * For production this swaps to Firestore one-for-one — that was always
 * the deck plan (slide 7, platform layer).
 */

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "calls.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

interface DbShape {
  calls: Record<string, CallRecord>;
  transcripts: Record<string, DialogueTurn[]>;
}

function readDb(): DbShape {
  if (!fs.existsSync(DB_FILE)) return { calls: {}, transcripts: {} };
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) as DbShape;
  } catch {
    return { calls: {}, transcripts: {} };
  }
}

function writeDb(db: DbShape): void {
  // Atomic write — write to temp, then rename. Avoids torn writes if the
  // process is killed mid-write (which would brick the demo).
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export interface CallRecord {
  id: string;
  twilio_call_sid?: string;
  direction: "inbound" | "outbound";
  payer_id: string;
  payer_name: string;
  npi: string;
  application_id: string;
  provider_name: string;
  target_phone?: string;
  status: "in_progress" | "completed" | "failed" | "escalated";
  final_state?: string;
  slots?: PartialCallSlots;
  recording_url?: string;
  started_at: number;
  ended_at?: number;
  escalation_reason?: string;
  /** Which dialogue mode handled this call. Older records may omit this. */
  mode?: "outbound" | "inbound_lookup";
  /** For inbound_lookup mode: id of the client record the agent found. */
  looked_up_client_id?: string;
  /** For inbound_lookup mode: the caller's self-identified name/org. */
  caller_identity?: string;
}

export function createCall(input: {
  id: string;
  direction: "inbound" | "outbound";
  payer_id: string;
  payer_name: string;
  npi: string;
  application_id: string;
  provider_name: string;
  target_phone?: string;
  mode?: "outbound" | "inbound_lookup";
}): void {
  const db = readDb();
  db.calls[input.id] = {
    ...input,
    status: "in_progress",
    started_at: Date.now(),
  };
  db.transcripts[input.id] = [];
  writeDb(db);
}

export function setLookedUpClient(callId: string, clientId: string): void {
  const db = readDb();
  if (db.calls[callId]) {
    db.calls[callId].looked_up_client_id = clientId;
    writeDb(db);
  }
}

export function setCallerIdentity(callId: string, identity: string): void {
  const db = readDb();
  if (db.calls[callId]) {
    db.calls[callId].caller_identity = identity;
    writeDb(db);
  }
}

export function attachTwilioSid(callId: string, sid: string): void {
  const db = readDb();
  if (db.calls[callId]) {
    db.calls[callId].twilio_call_sid = sid;
    writeDb(db);
  }
}

export function appendTurn(callId: string, turn: DialogueTurn): void {
  const db = readDb();
  if (!db.transcripts[callId]) db.transcripts[callId] = [];
  db.transcripts[callId].push(turn);
  writeDb(db);
}

export function updateSlots(callId: string, slots: PartialCallSlots): void {
  const db = readDb();
  if (db.calls[callId]) {
    db.calls[callId].slots = slots;
    writeDb(db);
  }
}

export function finishCall(input: {
  callId: string;
  status: CallRecord["status"];
  finalState?: string;
  recordingUrl?: string;
  escalationReason?: string;
}): void {
  const db = readDb();
  const call = db.calls[input.callId];
  if (!call) return;
  call.status = input.status;
  call.final_state = input.finalState;
  call.recording_url = input.recordingUrl;
  call.escalation_reason = input.escalationReason;
  call.ended_at = Date.now();
  writeDb(db);
}

export function getCall(callId: string): CallRecord | null {
  const db = readDb();
  return db.calls[callId] ?? null;
}

export function listCalls(limit = 50): CallRecord[] {
  const db = readDb();
  return Object.values(db.calls)
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, limit);
}

export function getTranscript(callId: string): DialogueTurn[] {
  const db = readDb();
  return db.transcripts[callId] ?? [];
}
