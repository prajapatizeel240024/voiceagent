import { Router, Request, Response } from "express";
import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { getCall, getTranscript, listCalls } from "../store/db.js";
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
} from "../store/clients.js";
import { liveBus } from "../store/livebus.js";
import { Playbook } from "../agent/playbook.js";

const ClientInputSchema = z.object({
  patient_name: z.string().min(1),
  date_of_birth: z.string().min(1),
  member_id: z.string().min(1),
  payer_id: z.string().min(1),
  service_authorized: z.string().min(1),
  auth_period_start: z.string().min(1),
  auth_period_end: z.string().min(1),
  authorization_status: z.enum(["active", "expired", "pending", "denied"]),
  last_visit_date: z.string().nullable(),
  next_visit_scheduled: z.string().nullable(),
  care_notes: z.string().default(""),
});

/**
 * REST routes the frontend uses:
 *
 *  GET  /api/calls                  list recent calls
 *  GET  /api/calls/:id              one call's record + transcript + slots
 *  GET  /api/playbooks              list available payer playbooks
 *  POST /api/calls/outbound         trigger an outbound demo call
 *                                   (proxies to /voice/place-outbound)
 *
 * Plus a WebSocket at /stream that pushes live events from liveBus.
 */
export function buildApiRoutes(opts: {
  playbooks: Record<string, Playbook>;
  publicUrl: string;
  port: number;
}): Router {
  const router = Router();
  const { playbooks } = opts;

  router.get("/calls", (_req: Request, res: Response) => {
    res.json(listCalls(50));
  });

  router.get("/calls/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const call = getCall(id);
    if (!call) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const transcript = getTranscript(id);
    res.json({ ...call, transcript });
  });

  router.get("/playbooks", (_req: Request, res: Response) => {
    res.json(
      Object.values(playbooks).map((p) => ({
        payer_id: p.payer_id,
        payer: p.payer,
        slot_count: p.slots.length,
      })),
    );
  });

  // ── Clients (inbound-lookup demo) ──────────────────────────────────
  router.get("/clients", (_req: Request, res: Response) => {
    res.json(listClients());
  });

  router.get("/clients/:id", (req: Request, res: Response) => {
    const c = getClient(String(req.params.id));
    if (!c) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(c);
  });

  router.post("/clients", (req: Request, res: Response) => {
    const parsed = ClientInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }
    const created = createClient(parsed.data);
    res.status(201).json(created);
  });

  router.delete("/clients/:id", (req: Request, res: Response) => {
    const ok = deleteClient(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  });

  // Convenience proxy — frontend hits this, we forward to /voice/place-outbound.
  router.post("/calls/outbound", async (req: Request, res: Response) => {
    try {
      const resp = await fetch(`http://localhost:${opts.port}/voice/place-outbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

/**
 * Live event WebSocket — every connected dashboard receives every event.
 * Frontend subscribes once and routes events by call_id.
 */
export function attachStreamWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/stream" });

  wss.on("connection", (ws) => {
    console.log("[ws:stream] dashboard connected");

    const unsub = liveBus.subscribe((event) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });

    ws.on("close", () => {
      unsub();
      console.log("[ws:stream] dashboard disconnected");
    });

    // Heartbeat — keep ngrok from killing idle connections.
    const hb = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 25_000);
    ws.on("close", () => clearInterval(hb));
  });

  console.log("[ws:stream] WebSocket server listening on /stream");
}
