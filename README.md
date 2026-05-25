# Atano · Voice Agent (prototype)

Outbound voice agent for payer status follow-ups. Built as the Week-0 prototype
promised in the Atano follow-up deck.

The agent calls a payer (or you, playing the payer rep), navigates IVR via
DTMF, identifies the practice + provider, asks scripted slot-filling
questions, extracts a Pydantic-equivalent (Zod) schema from the conversation,
and writes a structured row into a local dashboard — recording, transcript,
and parsed fields per call.

```
┌─────────────────────────────────────────────────────────────┐
│  Twilio  ◀──PSTN──▶  ConversationRelay  ◀──WS──▶  Node/TS   │
│                       (Deepgram STT,                Claude   │
│                        ElevenLabs TTS)              Sonnet   │
│                                                              │
│                       SQLite (JSON file)  ◀──WS──▶  React    │
│                       call records         dashboard         │
│                       transcripts          live + history    │
└─────────────────────────────────────────────────────────────┘
```

## What's in the repo

```
atano-voice-agent/
├── backend/
│   ├── src/
│   │   ├── server.ts              Express + dual WS servers
│   │   ├── agent/
│   │   │   ├── slots.ts           Zod slot schema (Pydantic-equiv)
│   │   │   ├── fsm.ts             7-state call FSM
│   │   │   ├── playbook.ts        Per-payer YAML loader
│   │   │   └── dialogue.ts        Claude turn engine (tool-use)
│   │   ├── routes/
│   │   │   ├── twilio.ts          Inbound + outbound TwiML
│   │   │   ├── agent-ws.ts        Twilio ConversationRelay handler
│   │   │   └── api.ts             REST + /stream WS for dashboard
│   │   ├── store/
│   │   │   ├── db.ts              JSON file persistence
│   │   │   └── livebus.ts         Pub/sub for live UI updates
│   │   └── eval/
│   │       └── run.ts             Per-slot accuracy harness
│   └── playbooks/
│       ├── aetna.yaml             "The asset that compounds"
│       └── bcbs-nj.yaml
└── frontend/
    └── src/
        ├── App.tsx                Split-pane dashboard
        ├── components/            SlotTable, TranscriptStream, etc.
        └── hooks/useLiveStream.ts WS subscription
```

## Prerequisites

- **Node 20+** (`node -v`)
- **ngrok** for tunneling Twilio webhooks to localhost (`brew install ngrok` or download)
- A **Twilio** account with a phone number (free trial includes $15 credit)
- An **Anthropic** API key
- ConversationRelay enabled on your Twilio account — accept the GenAI addendum in
  Twilio Console (Voice → Settings → Conversation Relay onboarding)

## Setup (one-time, ~10 minutes)

### 1. Install

```bash
git clone <your-repo>
cd atano-voice-agent
(cd backend && npm install)
(cd frontend && npm install)
```

### 2. Configure backend env

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys |
| `TWILIO_ACCOUNT_SID` | Twilio Console homepage |
| `TWILIO_AUTH_TOKEN` | Twilio Console homepage |
| `TWILIO_PHONE_NUMBER` | Twilio Console → Phone Numbers → Active numbers (E.164 format, e.g. `+15555550123`) |
| `PUBLIC_URL` | Fill in after step 4 |
| `DEMO_TARGET_PHONE` | Your cell phone in E.164 (e.g. `+15555550100`) |

### 3. Start the backend

```bash
# in backend/
npm run dev
```

It will fail with `missing required env var: PUBLIC_URL` — that's expected.
Leave the terminal open; we'll fill it in once ngrok is running.

### 4. Start ngrok (in a second terminal)

```bash
ngrok http 3000
```

Copy the `https://` Forwarding URL (e.g. `https://abc-123.ngrok-free.app`) and
paste it into `.env` as `PUBLIC_URL`. **Do not include a trailing slash.**

Restart the backend (`Ctrl+C` then `npm run dev` again). You should see:

```
╔══════════════════════════════════════════════════════════╗
║         Atano Voice Agent — backend running              ║
╚══════════════════════════════════════════════════════════╝

  HTTP            http://localhost:3000
  Public URL      https://abc-123.ngrok-free.app
  Twilio webhook  https://abc-123.ngrok-free.app/voice/inbound
  ...
```

### 5. Configure your Twilio phone number

Twilio Console → Phone Numbers → Active Numbers → click your number.

Scroll to **Voice Configuration**, set:

- **A call comes in** → Webhook → `https://abc-123.ngrok-free.app/voice/inbound` → POST

Save.

### 6. Start the frontend (in a third terminal)

```bash
cd frontend
npm run dev
```

Opens `http://localhost:5173`.

## Two ways to demo

### Inbound — you call the agent

Dial your Twilio phone number from your cell. The agent picks up and reads
the greeting from `playbooks/aetna.yaml`. You play the credentialing
coordinator on the other end. Speak naturally; the dashboard fills in
slot-by-slot as the agent extracts structured fields.

### Outbound — the agent calls you (primary demo)

In the dashboard, fill in:
- Payer: Aetna
- Target phone: your cell (E.164)
- NPI, application ID, provider name: defaults are fine

Click **Place call**. Your phone rings. Answer it and play the Aetna rep
("Aetna provider services, this is Sarah, how can I help?"). The agent will
introduce itself, ask the slot-filling questions, and write structured
output to the dashboard in real time.

## The Monday demo script

1. **Open the dashboard.** Empty history. Live pane shows "No call in progress."
2. **Show the YAML.** Open `backend/playbooks/aetna.yaml` — point at `slots:`,
   `ivr_map:`, and `guardrails:`. "This is the asset that compounds. A non-engineer
   coordinator edits this file to add a payer."
3. **Place the outbound call.** Click the button. Your phone rings.
4. **Answer and play the rep.** Try: *"Aetna provider services, this is Sarah."*
   The agent introduces itself with NPI + application ID.
5. **Walk through the slots.** *"That one's still in review with our credentialing
   committee. We need an updated DEA cert. Expect a decision in two weeks.
   Reference number AET-2026-4471."*
6. **Watch the dashboard.** Transcript streams left-to-right. Slot table fills
   row by row. Status badge goes from "Live" to "Completed."
7. **Click into history.** Open the just-completed call. Same data, persistent.
8. **Show the eval harness.** Back at the terminal: `npm run eval`. Runs 5
   synthetic fixtures, prints per-slot accuracy. "This is how we'd catch
   regressions when we add the 11th payer."
9. **Close.** "Week 1 is one payer, one intent. Week 8 is 10 payers and a YAML
   editor for non-engineers. That trajectory is on slide 11."

## Eval harness

```bash
cd backend
npm run eval
```

Runs `src/eval/run.ts` — replays 5 fixture transcripts through the dialogue
engine, compares Claude's extracted slots against ground truth, prints a
per-slot accuracy table. Output looks like:

```
  slot                     fill   acc    detail
  ─────────────────────────────────────────────
  application_status        100%   100%   5/5
  missing_items              80%    80%   4/5
  reference_number          100%   100%   5/5
  rep_name                  100%   100%   5/5

  Overall slot accuracy: 95.0%
```

## Troubleshooting

**`ConversationRelay not enabled`** — In Twilio Console, accept the
Predictive & Generative AI Features Addendum. Voice → Settings → Conversation
Relay → Get started.

**Call connects but agent is silent** — Check the backend terminal. If you
see `[ws:agent] setup OK` but no `prompt` messages, the rep isn't being
heard by Deepgram. Speak louder; make sure your phone isn't on mute. If you
see Claude errors, check `ANTHROPIC_API_KEY` and that your account has
access to `claude-sonnet-4-5`.

**`ngrok URL keeps changing`** — Free ngrok rotates the subdomain on every
restart. Either grab a static domain (free with email signup) or keep ngrok
running for the whole demo session.

**Twilio webhook is firing but returning 502** — Backend isn't running, or
`PUBLIC_URL` doesn't match the current ngrok tunnel. Check `/health` at
`https://your-ngrok-url/health` — should return JSON.

**Claude calls `submit_turn` but slots are wrong** — Tune the system prompt
in `src/agent/dialogue.ts` → `buildSystemPrompt`. The status enum mappings
and date-parsing rules live in the "Extraction rules" block.

## Important — do not call real payers

The placeholder phone numbers in `playbooks/aetna.yaml` and `bcbs-nj.yaml`
are Aetna and BCBS's real provider services lines. **Replace them with a
Twilio number you control or your own phone before any outbound call.**

Calling a real payer as a fictitious practice — even for a demo — risks
TCPA violations, state two-party-consent recording laws (NJ is two-party
consent), and the payer flagging your Twilio number for fraud. The IVR
navigation code is the same either way; for the demo you don't need
real payer lines.

## What's next (not in this prototype)

These were called out in the deck and are intentionally out of scope for
Week 0:

- Per-payer hold-music detection (slide 6 step 3) — the FSM has the `HOLD`
  state but the audio-energy detector isn't wired up; ConversationRelay
  handles silence/turn-taking well enough for the demo.
- Self-serve YAML editor (slide 11 Week 5–8) — edit the file directly for
  now.
- SOC 2 / HIPAA BAA configuration (slide 11 Quarter 2) — ConversationRelay
  is HIPAA-eligible; production setup requires a signed BAA with Twilio.
- Inbound provider voice agent / re-attestation reminders (slide 11 Quarter 3+).

## Stack reference

| Layer | Choice | Why |
|---|---|---|
| Voice transport | Twilio + ConversationRelay | Deck named Twilio; Relay collapses STT/TTS plumbing into one TwiML noun and one WebSocket |
| STT | Deepgram nova-3-general | Deck named, low latency, native via Relay |
| TTS | ElevenLabs | Deck named, natural-sounding, native via Relay |
| LLM | Claude Sonnet 4.5 with forced tool-use | Deck named; tool-use forces structured slot extraction every turn |
| Schema | Zod | Pydantic-equivalent in TypeScript |
| State | 7-state FSM | Same pattern as the Clinical Intake module (slide 9) |
| Playbooks | YAML | Same YAML-driven pattern as MIA (43+ visa modules → 15 generic screens) |
| Store | JSON file (demo) → Firestore (prod) | Same shape; file is zero-setup |
| Frontend | React + Vite + Tailwind | Fast to demo; familiar |
| Tunnel | ngrok | Required for Twilio to reach localhost |

— Zeel

## Deploy to GCP Compute Engine

See the prep files in `deploy/`. High-level:

1. Create an e2-small VM with a static external IP and HTTP/HTTPS firewall
2. SSH in, run `bash deploy/setup-vm.sh` (installs Node 20, Caddy, build tools)
3. Push this repo to a remote git host, clone it on the VM as the `atano` user
4. Set `backend/.env` with all required vars including `PUBLIC_URL=https://<VM-IP-with-dashes>.nip.io`
5. Run `bash deploy/install-app.sh` — builds, installs systemd service, configures Caddy
6. Update Twilio's voice webhook to `https://<VM-IP-with-dashes>.nip.io/voice/inbound`

## Demo 2: Inbound Patient Lookup

The Twilio phone number now does double duty. Outbound calls still go through
the credentialing-status flow on the dashboard. Inbound calls connect to
**Aria**, an automated assistant for *Hudson Valley Homecare* who looks up
patient records and reads them back to the caller.

**Flow:**

1. **Add patients on the dashboard.** Switch to the *Patients* tab and use
   the form to add a record (patient name, DOB, member ID, payer, authorized
   service, auth period, status, visit dates, care notes). The list to the
   right shows everything currently on file. Three seed patients are
   pre-loaded the first time the backend runs.
2. **Call the Twilio number** — `+1 (361) 266-9394`. Aria answers:
   > *"Hi, you've reached Hudson Valley Homecare. This is Aria, the automated assistant. Who am I speaking with?"*
3. **Identify yourself** (name + payer org). Aria will refuse to share any
   patient data until she has your identity.
4. **Name a patient** — by full name or by member ID. Aria calls the
   `lookup_client` tool against the local store and reads back the
   authorization status, auth period, last/next visit, and care notes.
5. **Ask follow-ups**, then hang up. The call shows up in *Call history*
   tagged with the patient she looked up.

The dashboard's **Calls** tab shows the live transcript on the left, plus a
"Patient record" panel that mirrors exactly what Aria has access to — handy
for showing demo viewers what the agent is reading from. A mode chip on the
live header reads *Inbound · Patient lookup* or *Outbound · Status check* so
you can tell the two flows apart at a glance.

**The original outbound flow still works** — use the "Place outbound call"
form on the Calls tab as before. It hits `/api/calls/outbound` and runs the
existing playbook-driven status-check dialogue. Both demos coexist on the
same number / dashboard / process.
