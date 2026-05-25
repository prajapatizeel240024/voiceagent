import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import twilio from "twilio";

import { loadAllPlaybooks } from "./agent/playbook.js";
import { buildTwilioRoutes } from "./routes/twilio.js";
import { attachAgentWebSocket } from "./routes/agent-ws.js";
import { attachStreamWebSocket, buildApiRoutes } from "./routes/api.js";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`[boot] missing required env var: ${name}`);
    console.error(`       copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const publicUrl = requireEnv("PUBLIC_URL", PUBLIC_URL);
  const twilioSid = requireEnv("TWILIO_ACCOUNT_SID", TWILIO_ACCOUNT_SID);
  const twilioAuth = requireEnv("TWILIO_AUTH_TOKEN", TWILIO_AUTH_TOKEN);
  const twilioPhone = requireEnv("TWILIO_PHONE_NUMBER", TWILIO_PHONE_NUMBER);
  requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);

  const playbooks = loadAllPlaybooks();
  if (Object.keys(playbooks).length === 0) {
    console.warn("[boot] no playbooks loaded — calls will fail");
  }

  const twilioClient = twilio(twilioSid, twilioAuth);

  const app = express();
  app.use(cors());
  app.use(express.urlencoded({ extended: false })); // Twilio webhooks send form-encoded
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      public_url: publicUrl,
      playbooks: Object.keys(playbooks),
    });
  });

  app.use("/voice", buildTwilioRoutes({
    playbooks,
    publicUrl,
    twilioClient,
    twilioPhoneNumber: twilioPhone,
  }));

  app.use("/api", buildApiRoutes({ playbooks, publicUrl, port: PORT }));

  // ── Serve the built frontend from the same port ──
  // In production the frontend is built to ../frontend/dist and served as
  // static files. Any non-API/non-voice route falls through to index.html
  // so React Router (if added later) works. Twilio webhooks and our APIs
  // are NOT caught by this because they're registered above.
  const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api|voice|agent-ws|stream|health).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });

  const server = http.createServer(app);

  // Both WebSocket servers share the HTTP server. Different paths route
  // to different handlers: /agent-ws is for Twilio, /stream is for the
  // frontend dashboard.
  attachAgentWebSocket(server, playbooks);
  attachStreamWebSocket(server);

  server.listen(PORT, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║         Atano Voice Agent — backend running              ║");
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  HTTP            http://localhost:${PORT}`);
    console.log(`  Public URL      ${publicUrl}`);
    console.log(`  Twilio webhook  ${publicUrl}/voice/inbound`);
    console.log(`  Agent WS        ${publicUrl.replace(/^http/, "ws")}/agent-ws`);
    console.log(`  Stream WS       ${publicUrl.replace(/^http/, "ws")}/stream`);
    console.log("");
    console.log(`  Loaded playbooks: ${Object.keys(playbooks).join(", ")}`);
    console.log("");
    console.log("  Next steps:");
    console.log(`   1. In Twilio Console, set ${publicUrl}/voice/inbound`);
    console.log(`      as the voice webhook for ${twilioPhone}`);
    console.log("   2. Start the frontend: cd ../frontend && npm run dev");
    console.log("   3. Call your Twilio number OR click 'Place outbound call'");
    console.log("");
  });
}

main().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
