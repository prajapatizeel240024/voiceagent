import { Router, Request, Response } from "express";
import twilio from "twilio";
import { randomUUID } from "node:crypto";
import { Playbook, hydrate } from "../agent/playbook.js";
import { createCall, attachTwilioSid } from "../store/db.js";
import { liveBus } from "../store/livebus.js";
import { INBOUND_GREETING } from "../agent/inbound-dialogue.js";

const INBOUND_MODE = "inbound_lookup";

/**
 * Twilio webhook routes.
 *
 *  POST /voice/inbound      Twilio hits this when someone CALLS our number.
 *                           We return TwiML that opens a ConversationRelay
 *                           session to our WebSocket.
 *
 *  POST /voice/outbound     We hit this from our own API to PLACE a call.
 *                           Triggers a Twilio REST call to dial out, with
 *                           the same TwiML pointing back at ConversationRelay.
 *
 *  POST /voice/status       Twilio status callbacks (ringing, in-progress, completed).
 *                           We use the completed event to mark the call done.
 */

export function buildTwilioRoutes(opts: {
  playbooks: Record<string, Playbook>;
  publicUrl: string;
  twilioClient: ReturnType<typeof twilio>;
  twilioPhoneNumber: string;
}): Router {
  const router = Router();
  const { playbooks, publicUrl, twilioClient, twilioPhoneNumber } = opts;

  /**
   * INBOUND webhook — Twilio POSTs here when our number receives a call.
   *
   * For the demo: Jake calls the Twilio number, our agent answers as if
   * it were Aetna's IVR (or vice versa, depending on demo direction).
   */
  router.post("/inbound", (req: Request, res: Response) => {
    const twilioCallSid = (req.body.CallSid as string) || `inbound-${randomUUID()}`;
    const from = (req.body.From as string) || "unknown";

    // Inbound demo runs the Aria assistant for Hudson Valley Homecare.
    // We don't bind to a payer playbook — Aria looks up patients out of
    // the local clients store.
    const callId = `call_${Date.now()}_${randomUUID().slice(0, 6)}`;
    createCall({
      id: callId,
      direction: "inbound",
      payer_id: "hudson_valley_homecare",
      payer_name: "Hudson Valley Homecare",
      npi: "",
      application_id: "",
      provider_name: "",
      target_phone: from,
      mode: INBOUND_MODE,
    });
    attachTwilioSid(callId, twilioCallSid);

    liveBus.publish({
      type: "call_started",
      call_id: callId,
      direction: "inbound",
      payer_id: "hudson_valley_homecare",
      payer_name: "Hudson Valley Homecare",
      started_at: Date.now(),
    });

    res.type("text/xml").send(
      buildConversationRelayTwiML({
        publicUrl,
        callId,
        playbookId: "",
        mode: INBOUND_MODE,
        welcomeGreeting: INBOUND_GREETING,
      }),
    );
  });

  /**
   * OUTBOUND trigger — called from our /api/calls/outbound REST endpoint.
   * Returns the TwiML that the *outbound* call will execute when answered.
   */
  router.post("/outbound-twiml", (req: Request, res: Response) => {
    const callId = (req.query.call_id as string) || (req.body.call_id as string);
    const playbookId = (req.query.playbook_id as string) || (req.body.playbook_id as string);
    const playbook = playbooks[playbookId];
    if (!callId || !playbook) {
      res.status(400).type("text/xml").send(
        `<?xml version="1.0"?><Response><Say>Missing call_id or playbook.</Say></Response>`,
      );
      return;
    }
    res.type("text/xml").send(buildConversationRelayTwiML({
      publicUrl,
      callId,
      playbookId: playbook.payer_id,
      mode: "outbound",
      welcomeGreeting: hydrate(playbook.script.greeting, {
        ...playbook.persona,
        npi: (req.query.npi as string) || "1234567890",
        application_id: (req.query.application_id as string) || "APP-DEMO-001",
        provider_name: (req.query.provider_name as string) || "Dr. Demo Provider",
      }).replace(/\n/g, " ").trim(),
    }));
  });

  /**
   * Helper used by our REST /api/calls/outbound — places the outbound call
   * via Twilio REST API. Returns the call SID.
   */
  router.post("/place-outbound", async (req: Request, res: Response) => {
    const {
      target_phone,
      playbook_id,
      npi,
      application_id,
      provider_name,
    } = req.body as {
      target_phone: string;
      playbook_id: string;
      npi: string;
      application_id: string;
      provider_name: string;
    };

    const playbook = playbooks[playbook_id];
    if (!playbook) {
      res.status(400).json({ error: `Unknown playbook: ${playbook_id}` });
      return;
    }

    const callId = `call_${Date.now()}_${randomUUID().slice(0, 6)}`;
    createCall({
      id: callId,
      direction: "outbound",
      payer_id: playbook.payer_id,
      payer_name: playbook.payer,
      npi,
      application_id,
      provider_name,
      target_phone,
      mode: "outbound",
    });

    const twimlUrl = `${publicUrl}/voice/outbound-twiml?call_id=${encodeURIComponent(callId)}&playbook_id=${encodeURIComponent(playbook_id)}&npi=${encodeURIComponent(npi)}&application_id=${encodeURIComponent(application_id)}&provider_name=${encodeURIComponent(provider_name)}`;

    try {
      const call = await twilioClient.calls.create({
        to: target_phone,
        from: twilioPhoneNumber,
        url: twimlUrl,
        statusCallback: `${publicUrl}/voice/status`,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        record: true,
        recordingStatusCallback: `${publicUrl}/voice/recording`,
      });
      attachTwilioSid(callId, call.sid);

      liveBus.publish({
        type: "call_started",
        call_id: callId,
        direction: "outbound",
        payer_id: playbook.payer_id,
        payer_name: playbook.payer,
        started_at: Date.now(),
      });

      res.json({ call_id: callId, twilio_sid: call.sid });
    } catch (err) {
      console.error("[twilio] outbound call failed:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/status", (req: Request, res: Response) => {
    console.log(`[twilio:status] ${req.body.CallSid} → ${req.body.CallStatus}`);
    res.sendStatus(204);
  });

  router.post("/recording", (req: Request, res: Response) => {
    console.log(`[twilio:recording] ${req.body.RecordingUrl}`);
    // We could update the call record here with the recording URL.
    res.sendStatus(204);
  });

  return router;
}

/**
 * Build the TwiML that hands the call to ConversationRelay.
 *
 * Twilio docs: https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
 *
 * Key choices:
 *   - transcriptionProvider=Deepgram (deck-named, low latency)
 *   - ttsProvider=ElevenLabs (deck-named, natural)
 *   - We pass call_id and playbook_id as custom <Parameter>s — they arrive
 *     in the WS setup message so we can route the right state machine.
 */
function buildConversationRelayTwiML(opts: {
  publicUrl: string;
  callId: string;
  playbookId: string;
  welcomeGreeting: string;
  mode: "outbound" | "inbound_lookup";
}): string {
  const wsUrl = opts.publicUrl.replace(/^http/, "ws") + "/agent-ws";
  const greeting = escapeXml(opts.welcomeGreeting);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${greeting}"
      ttsProvider="ElevenLabs"
      voice="UgBBYS2sOqTuMpoF3BR0"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      language="en-US"
      interruptible="speech"
      dtmfDetection="true">
      <Parameter name="call_id" value="${escapeXml(opts.callId)}"/>
      <Parameter name="playbook_id" value="${escapeXml(opts.playbookId)}"/>
      <Parameter name="mode" value="${escapeXml(opts.mode)}"/>
    </ConversationRelay>
  </Connect>
</Response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
