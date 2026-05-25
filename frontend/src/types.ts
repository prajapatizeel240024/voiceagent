// Mirrored from backend. Kept in sync by hand — small, stable.

export type CallState =
  | "GREET"
  | "IDENTIFY"
  | "IVR_NAV"
  | "HOLD"
  | "ASK"
  | "CLARIFY"
  | "CLOSE";

export interface DialogueTurn {
  role: "agent" | "rep";
  text: string;
  state: CallState;
  ts: number;
}

export type ApplicationStatus =
  | "in_review"
  | "missing_info"
  | "approved"
  | "denied"
  | "pending_committee"
  | "not_found"
  | "unknown";

export interface PartialCallSlots {
  application_status?: ApplicationStatus | null;
  missing_items?: string[];
  expected_decision_date?: string | null;
  reference_number?: string | null;
  rep_name?: string | null;
  notes?: string | null;
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
  mode?: "outbound" | "inbound_lookup";
  looked_up_client_id?: string;
  caller_identity?: string;
}

export type AuthorizationStatus = "active" | "expired" | "pending" | "denied";

export interface Client {
  id: string;
  patient_name: string;
  date_of_birth: string;
  member_id: string;
  payer_id: string;
  service_authorized: string;
  auth_period_start: string;
  auth_period_end: string;
  authorization_status: AuthorizationStatus;
  last_visit_date: string | null;
  next_visit_scheduled: string | null;
  care_notes: string;
  created_at: number;
}

export interface CallDetail extends CallRecord {
  transcript: DialogueTurn[];
}

export interface PlaybookSummary {
  payer_id: string;
  payer: string;
  slot_count: number;
}

export type LiveEvent =
  | {
      type: "call_started";
      call_id: string;
      direction: "inbound" | "outbound";
      payer_id: string;
      payer_name: string;
      started_at: number;
    }
  | {
      type: "transcript_turn";
      call_id: string;
      role: "agent" | "rep";
      text: string;
      state: CallState;
      ts: number;
    }
  | {
      type: "slots_updated";
      call_id: string;
      slots: PartialCallSlots;
    }
  | {
      type: "state_changed";
      call_id: string;
      state: CallState;
    }
  | {
      type: "call_ended";
      call_id: string;
      status: "completed" | "failed" | "escalated";
      ended_at: number;
    }
  | {
      type: "client_looked_up";
      call_id: string;
      client_id: string;
    }
  | { type: "ping" };
