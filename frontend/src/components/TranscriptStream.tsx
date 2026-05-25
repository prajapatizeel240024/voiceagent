import { useEffect, useRef } from "react";
import type { CallState, DialogueTurn } from "../types";

interface Props {
  turns: DialogueTurn[];
  currentState?: CallState;
}

const STATE_LABEL: Record<CallState, string> = {
  GREET: "Greeting",
  IDENTIFY: "Identifying",
  IVR_NAV: "Navigating IVR",
  HOLD: "On hold",
  ASK: "Asking question",
  CLARIFY: "Re-asking",
  CLOSE: "Wrapping up",
};

export function TranscriptStream({ turns, currentState }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length]);

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-panel2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Live transcript</h3>
        {currentState && (
          <span className="badge bg-panel border border-border text-muted">
            {STATE_LABEL[currentState]}
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {turns.length === 0 ? (
          <div className="text-muted text-sm italic text-center py-8">
            Waiting for the call to start…
          </div>
        ) : (
          turns.map((turn, i) => (
            <TurnRow key={i} turn={turn} />
          ))
        )}
      </div>
    </div>
  );
}

function TurnRow({ turn }: { turn: DialogueTurn }) {
  const isAgent = turn.role === "agent";
  return (
    <div
      className={`fade-in flex ${isAgent ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isAgent
            ? "bg-agent/10 border border-agent/30"
            : "bg-rep/10 border border-rep/30"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-xs font-semibold ${
              isAgent ? "text-agent" : "text-rep"
            }`}
          >
            {isAgent ? "Agent" : "Payer rep"}
          </span>
          <span className="text-[10px] text-muted">
            {STATE_LABEL[turn.state]}
          </span>
        </div>
        <p className="text-sm text-text leading-relaxed">{turn.text}</p>
      </div>
    </div>
  );
}
