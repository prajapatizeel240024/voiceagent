import { useCallback, useEffect, useRef, useState } from "react";
import { OutboundForm } from "./components/OutboundForm";
import { SlotTable } from "./components/SlotTable";
import { TranscriptStream } from "./components/TranscriptStream";
import { CallHistory } from "./components/CallHistory";
import { CallDetailPanel } from "./components/CallDetailPanel";
import { ClientsPanel } from "./components/ClientsPanel";
import { ClientLookupBadge } from "./components/ClientLookupBadge";
import { useLiveStream } from "./hooks/useLiveStream";
import type {
  CallRecord,
  CallState,
  DialogueTurn,
  LiveEvent,
  PartialCallSlots,
} from "./types";

type Tab = "calls" | "patients";

type LiveMode = "outbound" | "inbound_lookup";

/**
 * Top-level dashboard.
 *
 * Two top-level tabs:
 *   - Calls    — split-pane live + history (the outbound + inbound demos)
 *   - Patients — manage the client records Aria looks up on inbound calls
 */
export default function App() {
  const [tab, setTab] = useState<Tab>("calls");

  // ── Live pane state ────────────────────────────────────────────────
  const [liveCallId, setLiveCallId] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState<LiveMode>("outbound");
  const [liveTurns, setLiveTurns] = useState<DialogueTurn[]>([]);
  const [liveSlots, setLiveSlots] = useState<PartialCallSlots>({});
  const [liveState, setLiveState] = useState<CallState | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<
    "in_progress" | "completed" | "failed" | "escalated" | null
  >(null);
  const [liveLookupClientId, setLiveLookupClientId] = useState<string | null>(
    null,
  );

  // ── History pane state ─────────────────────────────────────────────
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null,
  );

  // ── Live event handler ─────────────────────────────────────────────
  const handleEvent = useCallback((e: LiveEvent) => {
    switch (e.type) {
      case "call_started":
        setLiveCallId(e.call_id);
        // Inbound on our number is always the lookup demo. Outbound is
        // always the status-check demo. Mode is later confirmed by the
        // server-side record but we set it optimistically here.
        setLiveMode(e.direction === "inbound" ? "inbound_lookup" : "outbound");
        setLiveTurns([]);
        setLiveSlots({});
        setLiveState("GREET");
        setLiveStatus("in_progress");
        setLiveLookupClientId(null);
        setHistoryRefreshKey((k) => k + 1);
        break;

      case "transcript_turn":
        if (e.call_id === liveCallIdRef.current) {
          setLiveTurns((prev) => [
            ...prev,
            { role: e.role, text: e.text, state: e.state, ts: e.ts },
          ]);
          setLiveState(e.state);
        }
        break;

      case "slots_updated":
        if (e.call_id === liveCallIdRef.current) {
          setLiveSlots(e.slots);
        }
        break;

      case "state_changed":
        if (e.call_id === liveCallIdRef.current) {
          setLiveState(e.state);
        }
        break;

      case "client_looked_up":
        if (e.call_id === liveCallIdRef.current) {
          setLiveLookupClientId(e.client_id);
        }
        break;

      case "call_ended":
        if (e.call_id === liveCallIdRef.current) {
          setLiveStatus(e.status);
        }
        setHistoryRefreshKey((k) => k + 1);
        break;
    }
  }, []);

  const liveCallIdRef = useRefValue(liveCallId);

  const wsStatus = useLiveStream(handleEvent);

  // When the live call changes, fetch the record so we can keep `mode` and
  // any pre-existing looked_up_client_id accurate (e.g. user navigated away
  // and came back during the same call).
  useEffect(() => {
    if (!liveCallId) return;
    fetch(`/api/calls/${liveCallId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rec: CallRecord | null) => {
        if (!rec) return;
        if (rec.mode === "inbound_lookup") setLiveMode("inbound_lookup");
        else if (rec.mode === "outbound") setLiveMode("outbound");
        if (rec.looked_up_client_id) {
          setLiveLookupClientId(rec.looked_up_client_id);
        }
      })
      .catch(() => {});
  }, [liveCallId]);

  return (
    <div className="h-full flex flex-col">
      <Header wsStatus={wsStatus} tab={tab} setTab={setTab} />

      {tab === "calls" ? (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 min-h-0">
          {/* ── LEFT: LIVE ────────────────────────────────────────── */}
          <section className="flex flex-col gap-3 min-h-0">
            <OutboundForm onCallPlaced={(id) => setLiveCallId(id)} />

            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {liveCallId ? (
                <>
                  <LiveCallHeader
                    callId={liveCallId}
                    mode={liveMode}
                    status={liveStatus}
                  />
                  {liveMode === "inbound_lookup" && liveLookupClientId && (
                    <ClientLookupBadge
                      clientId={liveLookupClientId}
                      variant="compact"
                    />
                  )}
                  <div className="flex-1 min-h-0">
                    <TranscriptStream
                      turns={liveTurns}
                      currentState={liveState}
                    />
                  </div>
                  {liveMode === "inbound_lookup" ? (
                    liveLookupClientId ? (
                      <ClientLookupBadge
                        clientId={liveLookupClientId}
                        variant="full"
                      />
                    ) : (
                      <WaitingForLookup />
                    )
                  ) : (
                    <SlotTable slots={liveSlots} />
                  )}
                </>
              ) : (
                <EmptyLivePane />
              )}
            </div>
          </section>

          {/* ── RIGHT: HISTORY ──────────────────────────────────────── */}
          <section className="flex flex-col gap-3 min-h-0">
            {selectedHistoryId ? (
              <>
                <button
                  className="btn-secondary self-start text-xs"
                  onClick={() => setSelectedHistoryId(null)}
                >
                  ← Back to list
                </button>
                <div className="flex-1 min-h-0">
                  <CallDetailPanel callId={selectedHistoryId} />
                </div>
              </>
            ) : (
              <CallHistory
                refreshKey={historyRefreshKey}
                selectedId={selectedHistoryId}
                onSelect={setSelectedHistoryId}
              />
            )}
          </section>
        </main>
      ) : (
        <main className="flex-1 p-3 min-h-0">
          <ClientsPanel />
        </main>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function Header({
  wsStatus,
  tab,
  setTab,
}: {
  wsStatus: "connecting" | "open" | "closed";
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const dotColor =
    wsStatus === "open"
      ? "bg-accent"
      : wsStatus === "connecting"
        ? "bg-warn"
        : "bg-danger";
  return (
    <header className="border-b border-border bg-panel px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-text font-semibold text-base tracking-tight">
            Atano · Voice agent
          </h1>
          <p className="text-muted text-xs">
            Outbound status calls + inbound patient lookup
          </p>
        </div>
        <nav className="flex items-center gap-1">
          <TabButton active={tab === "calls"} onClick={() => setTab("calls")}>
            Calls
          </TabButton>
          <TabButton
            active={tab === "patients"}
            onClick={() => setTab("patients")}
          >
            Patients
          </TabButton>
        </nav>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span
          className={`w-2 h-2 rounded-full ${dotColor} ${wsStatus === "open" ? "live-dot" : ""}`}
        />
        {wsStatus === "open"
          ? "Live stream connected"
          : wsStatus === "connecting"
            ? "Connecting…"
            : "Stream offline"}
      </div>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-panel2 text-text border border-border"
          : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function LiveCallHeader({
  callId,
  mode,
  status,
}: {
  callId: string;
  mode: LiveMode;
  status: "in_progress" | "completed" | "failed" | "escalated" | null;
}) {
  const label =
    status === "in_progress"
      ? "Live"
      : status === "completed"
        ? "Completed"
        : status === "escalated"
          ? "Escalated"
          : status === "failed"
            ? "Failed"
            : "Live";
  const color =
    status === "in_progress" || !status
      ? "bg-accent/15 text-accent border-accent/30"
      : status === "completed"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : "bg-amber-500/15 text-amber-400 border-amber-500/30";
  const modeLabel =
    mode === "inbound_lookup"
      ? "Inbound · Patient lookup"
      : "Outbound · Status check";
  const modeColor =
    mode === "inbound_lookup"
      ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
      : "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return (
    <div className="panel px-4 py-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`badge border ${modeColor}`}>{modeLabel}</span>
        <div className="text-xs font-mono text-muted truncate">{callId}</div>
      </div>
      <span className={`badge border ${color}`}>
        {status === "in_progress" || !status ? (
          <span className="w-1.5 h-1.5 bg-accent rounded-full live-dot mr-1.5" />
        ) : null}
        {label}
      </span>
    </div>
  );
}

function WaitingForLookup() {
  return (
    <div className="panel px-4 py-3 text-xs text-muted italic">
      Waiting for Aria to look up a patient…
    </div>
  );
}

function EmptyLivePane() {
  return (
    <div className="panel flex-1 flex items-center justify-center text-center p-8">
      <div>
        <div className="text-text font-medium mb-1">No call in progress</div>
        <p className="text-muted text-sm max-w-xs">
          Place an outbound call above, or dial your Twilio number to reach
          Aria for the inbound patient-lookup demo.
        </p>
      </div>
    </div>
  );
}

function useRefValue<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
