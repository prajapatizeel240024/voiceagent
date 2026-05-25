import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "../types";

/**
 * Subscribe to the backend's /stream WebSocket and route every event to
 * the supplied handler. Auto-reconnects on disconnect with backoff.
 *
 * Returns the current connection status so the UI can show a live dot.
 */
export function useLiveStream(handler: (e: LiveEvent) => void) {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let cancelled = false;
    let backoff = 500;

    const connect = () => {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/stream`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("open");
        backoff = 500;
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as LiveEvent;
          if (parsed.type === "ping") return;
          handlerRef.current(parsed);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setStatus("closed");
        if (cancelled) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 8000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, []);

  return status;
}
