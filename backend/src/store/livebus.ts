import { EventEmitter } from "node:events";
import { CallState } from "../agent/fsm.js";
import { PartialCallSlots } from "../agent/slots.js";

/**
 * Single global event bus. Every call session publishes here; the
 * /stream WebSocket endpoint forwards to connected dashboards.
 *
 * Why a singleton: there's only one demo running at a time. In prod
 * this would be Pub/Sub (same pattern as Agent Gateway).
 */

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
    };

class LiveBus extends EventEmitter {
  publish(event: LiveEvent): void {
    this.emit("event", event);
  }
  subscribe(fn: (e: LiveEvent) => void): () => void {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}

export const liveBus = new LiveBus();
// We may have many subscribers in long demos — bump the cap.
liveBus.setMaxListeners(100);
