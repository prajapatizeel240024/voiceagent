import { useEffect, useState } from "react";
import type { PlaybookSummary } from "../types";

interface Props {
  onCallPlaced: (callId: string) => void;
}

export function OutboundForm({ onCallPlaced }: Props) {
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [playbookId, setPlaybookId] = useState("aetna");
  const [phone, setPhone] = useState("");
  const [npi, setNpi] = useState("1234567890");
  const [appId, setAppId] = useState("APP-DEMO-001");
  const [provider, setProvider] = useState("Dr. Demo Provider");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/playbooks")
      .then((r) => r.json())
      .then(setPlaybooks)
      .catch(() => {});
  }, []);

  const place = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/calls/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_phone: phone,
          playbook_id: playbookId,
          npi,
          application_id: appId,
          provider_name: provider,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Call failed");
      onCallPlaced(data.call_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text">Place outbound call</h3>
        <p className="text-xs text-muted mt-0.5">
          Agent dials your number; you play the payer rep
        </p>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs text-muted">Payer</span>
          <select
            className="input mt-1"
            value={playbookId}
            onChange={(e) => setPlaybookId(e.target.value)}
          >
            {playbooks.map((p) => (
              <option key={p.payer_id} value={p.payer_id}>
                {p.payer} ({p.slot_count} slots)
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-muted">Target phone (your cell)</span>
          <input
            className="input mt-1"
            placeholder="+15555550100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-muted">NPI</span>
            <input
              className="input mt-1 font-mono text-xs"
              value={npi}
              onChange={(e) => setNpi(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Application ID</span>
            <input
              className="input mt-1 font-mono text-xs"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-muted">Provider name</span>
          <input
            className="input mt-1"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </label>
      </div>

      <button
        className="btn-primary w-full"
        disabled={loading || !phone}
        onClick={place}
      >
        {loading ? "Dialing…" : "Place call"}
      </button>

      {error && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
