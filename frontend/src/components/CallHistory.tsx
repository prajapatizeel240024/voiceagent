import { useEffect, useState } from "react";
import type { CallRecord } from "../types";

interface Props {
  /** Re-fetch when this ticks (we tick on every call_started/ended event). */
  refreshKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_STYLE: Record<string, string> = {
  in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  escalated: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

export function CallHistory({ refreshKey, selectedId, onSelect }: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);

  useEffect(() => {
    fetch("/api/calls")
      .then((r) => r.json())
      .then(setCalls)
      .catch(() => {});
  }, [refreshKey]);

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-panel2">
        <h3 className="text-sm font-semibold text-text">Call history</h3>
        <p className="text-xs text-muted mt-0.5">{calls.length} total</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {calls.length === 0 ? (
          <div className="text-muted text-sm italic text-center py-8 px-4">
            No calls yet. Place an outbound or call your Twilio number.
          </div>
        ) : (
          <ul>
            {calls.map((call) => {
              const isSelected = call.id === selectedId;
              return (
                <li key={call.id}>
                  <button
                    className={`w-full text-left px-4 py-3 border-b border-border hover:bg-panel2 transition-colors ${
                      isSelected ? "bg-panel2" : ""
                    }`}
                    onClick={() => onSelect(call.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm text-text font-medium truncate">
                          {call.payer_name}
                        </div>
                        <div className="text-xs text-muted mt-0.5 font-mono">
                          {call.application_id} · NPI {call.npi}
                        </div>
                        <div className="text-[10px] text-muted mt-1">
                          {new Date(call.started_at).toLocaleString()}
                        </div>
                      </div>
                      <span
                        className={`badge border shrink-0 ${
                          STATUS_STYLE[call.status] || STATUS_STYLE.failed
                        }`}
                      >
                        {call.status.replace("_", " ")}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
