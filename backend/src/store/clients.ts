import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Client (patient) records for the inbound-lookup demo flow.
 *
 * Same atomic-write JSON-file pattern as db.ts. Volume is tiny — a few
 * patients per practice for a demo — flat-file is fine. Production swaps
 * one-for-one to Firestore.
 *
 * On first load we seed three example patients so the demo has data even
 * on a fresh VM where the operator hasn't added anything yet.
 */

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

export interface Client {
  id: string;
  patient_name: string;
  date_of_birth: string;
  member_id: string;
  payer_id: string;
  service_authorized: string;
  auth_period_start: string;
  auth_period_end: string;
  authorization_status: "active" | "expired" | "pending" | "denied";
  last_visit_date: string | null;
  next_visit_scheduled: string | null;
  care_notes: string;
  created_at: number;
}

interface DbShape {
  clients: Record<string, Client>;
}

const SEED_CLIENTS: Omit<Client, "id" | "created_at">[] = [
  {
    patient_name: "John Martinez",
    date_of_birth: "1952-04-15",
    member_id: "BCBS-NJ-99102837",
    payer_id: "bcbs_nj",
    service_authorized: "Home health aide, 4 visits/week",
    auth_period_start: "2026-01-01",
    auth_period_end: "2026-03-31",
    authorization_status: "active",
    last_visit_date: "2026-05-20",
    next_visit_scheduled: "2026-05-27",
    care_notes: "Stable, weekly wound care.",
  },
  {
    patient_name: "Maria Gonzalez",
    date_of_birth: "1948-09-22",
    member_id: "AET-NJ-44218810",
    payer_id: "aetna",
    service_authorized: "Skilled nursing, 2 visits/week",
    auth_period_start: "2026-02-01",
    auth_period_end: "2026-07-31",
    authorization_status: "active",
    last_visit_date: "2026-05-22",
    next_visit_scheduled: "2026-05-29",
    care_notes: "Diabetes management, A1c trending down.",
  },
  {
    patient_name: "Robert Chen",
    date_of_birth: "1961-11-08",
    member_id: "UHC-77103392",
    payer_id: "uhc",
    service_authorized: "Physical therapy, 3 visits/week",
    auth_period_start: "2026-04-01",
    auth_period_end: "2026-06-30",
    authorization_status: "pending",
    last_visit_date: null,
    next_visit_scheduled: null,
    care_notes: "Awaiting Medicare secondary auth.",
  },
];

function newClientId(): string {
  return `c_${Date.now()}_${randomUUID().slice(0, 6)}`;
}

function seed(): DbShape {
  const now = Date.now();
  const db: DbShape = { clients: {} };
  for (const c of SEED_CLIENTS) {
    const id = newClientId();
    db.clients[id] = { ...c, id, created_at: now };
  }
  return db;
}

function readDb(): DbShape {
  if (!fs.existsSync(CLIENTS_FILE)) {
    const seeded = seed();
    writeDb(seeded);
    return seeded;
  }
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf-8")) as DbShape;
  } catch {
    return { clients: {} };
  }
}

function writeDb(db: DbShape): void {
  const tmp = CLIENTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, CLIENTS_FILE);
}

export function createClient(input: Omit<Client, "id" | "created_at">): Client {
  const db = readDb();
  const client: Client = {
    ...input,
    id: newClientId(),
    created_at: Date.now(),
  };
  db.clients[client.id] = client;
  writeDb(db);
  return client;
}

export function listClients(): Client[] {
  const db = readDb();
  return Object.values(db.clients).sort((a, b) => b.created_at - a.created_at);
}

export function getClient(id: string): Client | null {
  const db = readDb();
  return db.clients[id] ?? null;
}

export function deleteClient(id: string): boolean {
  const db = readDb();
  if (!db.clients[id]) return false;
  delete db.clients[id];
  writeDb(db);
  return true;
}

/**
 * Lookup by free-text query — patient name (case-insensitive substring) or
 * member ID (digits-only equality after stripping non-digits from both
 * sides). Returns the first match.
 */
export function findClientByQuery(query: string): Client | null {
  const q = query.trim();
  if (!q) return null;
  const db = readDb();
  const clients = Object.values(db.clients);

  const qLower = q.toLowerCase();
  const qDigits = q.replace(/\D/g, "");

  for (const c of clients) {
    if (c.patient_name.toLowerCase().includes(qLower)) return c;
  }
  if (qDigits.length > 0) {
    for (const c of clients) {
      const memberDigits = c.member_id.replace(/\D/g, "");
      if (memberDigits && memberDigits === qDigits) return c;
    }
  }
  return null;
}
