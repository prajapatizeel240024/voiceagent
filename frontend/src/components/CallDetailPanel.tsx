import { useEffect, useState } from "react";
import type { CallDetail } from "../types";
import { SlotTable } from "./SlotTable";
import { TranscriptStream } from "./TranscriptStream";
import { ClientLookupBadge } from "./ClientLookupBadge";

interface Props {
  callId: string;
}

export function CallDetailPanel({ callId }: Props) {
  const [data, setData] = useState<CallDetail | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/calls/${callId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [callId]);

  if (!data) {
    return (
      <div className="text-muted text-sm italic text-center py-8">
        Loading call…
      </div>
    );
  }

  const isInbound = data.mode === "inbound_lookup";
  const headerSecondary = isInbound
    ? data.caller_identity
      ? `Caller: ${data.caller_identity}`
      : "Caller identity not captured"
    : `${data.application_id} · NPI ${data.npi} · ${data.provider_name}`;

  return (
    <div className="space-y-3 h-full flex flex-col min-h-0">
      <div className="panel p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted">
              {data.direction} · {new Date(data.started_at).toLocaleString()}
            </div>
            <div className="text-sm font-semibold text-text mt-1">
              {data.payer_name}
            </div>
            <div className="text-xs text-muted font-mono mt-0.5">
              {headerSecondary}
            </div>
          </div>
          <span
            className={`badge border ${
              data.status === "completed"
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : data.status === "in_progress"
                  ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                  : "bg-amber-500/15 text-amber-400 border-amber-500/30"
            }`}
          >
            {data.status.replace("_", " ")}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <TranscriptStream
          turns={data.transcript}
          currentState={data.final_state as never}
        />
      </div>
      {isInbound ? (
        data.looked_up_client_id ? (
          <ClientLookupBadge
            clientId={data.looked_up_client_id}
            variant="full"
          />
        ) : (
          <div className="panel px-4 py-3 text-xs text-muted italic">
            No patient lookup performed on this call.
          </div>
        )
      ) : (
        <SlotTable slots={data.slots || {}} />
      )}
    </div>
  );
}
