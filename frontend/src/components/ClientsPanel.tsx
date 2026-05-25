import { useEffect, useState } from "react";
import type { AuthorizationStatus, Client } from "../types";

const STATUS_COLOR: Record<AuthorizationStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  expired: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  denied: "bg-red-500/15 text-red-400 border-red-500/30",
};

interface FormState {
  patient_name: string;
  date_of_birth: string;
  member_id: string;
  payer_id: string;
  service_authorized: string;
  auth_period_start: string;
  auth_period_end: string;
  authorization_status: AuthorizationStatus;
  last_visit_date: string;
  next_visit_scheduled: string;
  care_notes: string;
}

const EMPTY_FORM: FormState = {
  patient_name: "",
  date_of_birth: "",
  member_id: "",
  payer_id: "aetna",
  service_authorized: "",
  auth_period_start: "",
  auth_period_end: "",
  authorization_status: "active",
  last_visit_date: "",
  next_visit_scheduled: "",
  care_notes: "",
};

export function ClientsPanel() {
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setClients)
      .catch(() => {});
  };
  useEffect(load, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        last_visit_date: form.last_visit_date.trim() || null,
        next_visit_scheduled: form.next_visit_scheduled.trim() || null,
        care_notes: form.care_notes,
      };
      const resp = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Save failed");
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this patient record?")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-full min-h-0">
      <div className="panel p-4 space-y-3 overflow-y-auto">
        <div>
          <h3 className="text-sm font-semibold text-text">Add patient</h3>
          <p className="text-xs text-muted mt-0.5">
            New records become available to Aria on the next inbound call
          </p>
        </div>

        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted">Patient name</span>
            <input
              className="input mt-1"
              value={form.patient_name}
              onChange={(e) => update("patient_name", e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-muted">Date of birth</span>
              <input
                className="input mt-1 font-mono text-xs"
                placeholder="1952-04-15"
                value={form.date_of_birth}
                onChange={(e) => update("date_of_birth", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Member ID</span>
              <input
                className="input mt-1 font-mono text-xs"
                value={form.member_id}
                onChange={(e) => update("member_id", e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-muted">Payer</span>
            <select
              className="input mt-1"
              value={form.payer_id}
              onChange={(e) => update("payer_id", e.target.value)}
            >
              <option value="aetna">Aetna</option>
              <option value="bcbs_nj">BCBS NJ</option>
              <option value="uhc">UHC</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-muted">Service authorized</span>
            <input
              className="input mt-1"
              placeholder="Home health aide, 4 visits/week"
              value={form.service_authorized}
              onChange={(e) => update("service_authorized", e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-muted">Auth start</span>
              <input
                className="input mt-1 font-mono text-xs"
                placeholder="2026-01-01"
                value={form.auth_period_start}
                onChange={(e) => update("auth_period_start", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Auth end</span>
              <input
                className="input mt-1 font-mono text-xs"
                placeholder="2026-03-31"
                value={form.auth_period_end}
                onChange={(e) => update("auth_period_end", e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-muted">Authorization status</span>
            <select
              className="input mt-1"
              value={form.authorization_status}
              onChange={(e) =>
                update(
                  "authorization_status",
                  e.target.value as AuthorizationStatus,
                )
              }
            >
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="expired">expired</option>
              <option value="denied">denied</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-muted">Last visit</span>
              <input
                className="input mt-1 font-mono text-xs"
                placeholder="2026-05-20"
                value={form.last_visit_date}
                onChange={(e) => update("last_visit_date", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Next visit</span>
              <input
                className="input mt-1 font-mono text-xs"
                placeholder="2026-05-27"
                value={form.next_visit_scheduled}
                onChange={(e) =>
                  update("next_visit_scheduled", e.target.value)
                }
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-muted">Care notes</span>
            <textarea
              className="input mt-1 min-h-[64px]"
              value={form.care_notes}
              onChange={(e) => update("care_notes", e.target.value)}
            />
          </label>
        </div>

        <button
          className="btn-primary w-full"
          onClick={submit}
          disabled={
            saving ||
            !form.patient_name ||
            !form.date_of_birth ||
            !form.member_id ||
            !form.service_authorized
          }
        >
          {saving ? "Saving…" : "Add patient"}
        </button>

        {error && (
          <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <div className="panel flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-panel2">
          <h3 className="text-sm font-semibold text-text">Patients on file</h3>
          <p className="text-xs text-muted mt-0.5">{clients.length} total</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {clients.length === 0 ? (
            <div className="text-muted text-sm italic text-center py-8 px-4">
              No patients yet. Add one to start the inbound demo.
            </div>
          ) : (
            <ul>
              {clients.map((c) => (
                <li
                  key={c.id}
                  className="px-4 py-3 border-b border-border last:border-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-text font-medium truncate">
                        {c.patient_name}
                      </div>
                      <div className="text-xs text-muted mt-0.5 font-mono">
                        {c.member_id} · DOB {c.date_of_birth}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {c.service_authorized}
                      </div>
                      <div className="text-[10px] text-muted mt-1 font-mono">
                        {c.auth_period_start} → {c.auth_period_end}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span
                        className={`badge border ${STATUS_COLOR[c.authorization_status]}`}
                      >
                        {c.authorization_status}
                      </span>
                      <button
                        className="text-xs text-muted hover:text-danger"
                        onClick={() => remove(c.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
