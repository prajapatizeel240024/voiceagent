import { useEffect, useState } from "react";
import type { AuthorizationStatus, Client } from "../types";

interface Props {
  clientId: string;
  /** Compact one-liner vs. the fuller record card. */
  variant?: "compact" | "full";
}

const STATUS_COLOR: Record<AuthorizationStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  expired: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  denied: "bg-red-500/15 text-red-400 border-red-500/30",
};

export function ClientLookupBadge({ clientId, variant = "compact" }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setClient(null);
    setMissing(false);
    fetch(`/api/clients/${clientId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((c: Client) => {
        if (!cancelled) setClient(c);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (missing) {
    return (
      <div className="panel px-3 py-2 text-xs text-muted italic">
        Patient record not found
      </div>
    );
  }
  if (!client) {
    return (
      <div className="panel px-3 py-2 text-xs text-muted italic">
        Loading patient…
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="panel px-3 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text truncate">
            {client.patient_name}
          </div>
          <div className="text-xs text-muted font-mono truncate">
            {client.member_id}
          </div>
        </div>
        <span
          className={`badge border shrink-0 ${STATUS_COLOR[client.authorization_status]}`}
        >
          {client.authorization_status}
        </span>
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-panel2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">Patient record</h3>
          <p className="text-xs text-muted mt-0.5">
            What Aria is reading from
          </p>
        </div>
        <span
          className={`badge border ${STATUS_COLOR[client.authorization_status]}`}
        >
          {client.authorization_status}
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <Row label="Patient">{client.patient_name}</Row>
          <Row label="Date of birth" mono>
            {client.date_of_birth}
          </Row>
          <Row label="Member ID" mono>
            {client.member_id}
          </Row>
          <Row label="Service authorized">{client.service_authorized}</Row>
          <Row label="Auth period" mono>
            {client.auth_period_start} → {client.auth_period_end}
          </Row>
          <Row label="Last visit" mono>
            {client.last_visit_date || "—"}
          </Row>
          <Row label="Next visit" mono>
            {client.next_visit_scheduled || "—"}
          </Row>
          <Row label="Care notes">{client.care_notes || "—"}</Row>
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 text-muted font-medium w-1/3 align-top">
        {label}
      </td>
      <td
        className={`px-4 py-2 text-text ${mono ? "font-mono text-xs" : "text-sm"}`}
      >
        {children}
      </td>
    </tr>
  );
}
