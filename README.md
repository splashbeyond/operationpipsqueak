# Piper

SMS automation: upload a CSV → handshake text → customer replies "YES" → payload follow-up.

The system has two surfaces:

- **`api/`** — Node.js + Express. Reads/writes Airtable, sends SMS via Blooio.
- **`frontend/`** — Vite + React dashboard for upload + stats.

Tracking and auth are intentionally out of scope today; both will be added later.

## Architecture (first principles)

```
CSV upload ──▶ Airtable: Customer Data (Awaiting)
                     │
                     ▼
              Outbound worker  ──▶  Campaign Logs (Handshake Sent)
                     │                    │
                     └────────── send handshake SMS via Blooio
                                          │
                                          ▼
              Customer replies ──▶ Blooio webhook ──▶ POST /webhook
                                                       │
                                  ┌────────────────────┴────────────────────┐
                                  ▼                                         ▼
                        body matches "YES"                            anything else
                                  │                                         │
                          send payload SMS                          mark "Replied"
                          mark "Payload Sent"                       (optional reminder)
```

There is one source of truth for schema and options: `api/config.js`.
All Airtable interaction lives in `api/services/airtable.js`.
Templates collapse to two functions: `getHandshakeTemplate`, `getPayloadTemplate`.

## Running locally

```bash
npm install
cp .env.example .env       # then fill AIRTABLE_API_KEY + AIRTABLE_BASE_ID
npm run dev:all            # API on :3000 + dashboard on :5173
```

For inbound (`YES → payload`) you need Blooio to reach your machine. Either:

1. **Deploy** (recommended — set it once, see below), or
2. **Local ngrok tunnel** (free, stable):
   - Get authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
   - Reserve a free domain: https://dashboard.ngrok.com/cloud-edge/domains
   - Add to `.env`:
     ```
     NGROK_AUTHTOKEN=<your-token>
     NGROK_DOMAIN=<your>.ngrok-free.app
     ENABLE_DEV_TUNNEL=1
     ```
   - Run `npm run dev:all:tunnel`. The banner prints `https://<your>.ngrok-free.app/webhook` —
     paste it into Blooio **once**. It never changes again.

## Required Airtable schema (defaults)

| Table          | Required columns                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Company Info   | `Company ID`, `Business Name`, `Blooio API Key & Phone`, `Review Link`/`Booking Link`/`Membership Link`,  |
|                | per-campaign `Handshake: …` + `Payload: …` columns, optional `Handshake Matrix` / `Payload Matrix (…)`    |
| Customer Data  | `Name`, `Phone Number`, `Campaign Type`, `Status` (Awaiting/Sent/Failed/Processing), `Company ID` (link), `Reward` |
| Campaign Logs  | `Company ID` (link), `Phone Number`, `Campaign Type`, `Status`, `Latest Reply`, `Replied At`, `Handshake Sent At` |
| Uploads        | `Status`, `Batch ID` (optional), `Company` (link), `Company ID` (text)                                    |
| Global DNC     | `Phone Number`                                                                                             |

If your column or option labels differ, set the matching `AIRTABLE_*` env override (see `.env.example`).

## Deploying to Render (no Docker)

1. Commit and push to GitHub.
2. In Render → **Blueprints** → **New** → point at this repo. `render.yaml` provisions:
   - `piper-api` (Node web service, runs `npm start`)
   - `piper-frontend` (static site built from `frontend/`)
3. After the first deploy, set:
   - On `piper-api`: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `OPENAI_API_KEY`.
   - On `piper-frontend`: `VITE_API_URL` = the public URL of `piper-api`.
4. In Blooio → Webhooks → Inbound URL: `https://piper-api.onrender.com/webhook`.

Health check: `GET /health` returns `{ ok: true }` (Render uses this for healthchecks).

## Deploying to any other host

Anywhere that runs Node 18+ works:

```bash
npm ci --omit=dev
NODE_ENV=production AIRTABLE_API_KEY=… AIRTABLE_BASE_ID=… npm start
```

The frontend is a static build:

```bash
cd frontend && npm ci && npm run build
# Serve frontend/dist with any static host (Vercel, Netlify, S3+CloudFront, …)
# Set VITE_API_URL=https://<your-api-host> at build time.
```

For the outbound worker you have two choices:

- **Inline (default):** the API process polls Awaiting customers every `PROCESSOR_INTERVAL_SECONDS`.
- **External cron:** set `DISABLE_INLINE_PROCESSOR=1` and POST to `/process` from your scheduler with header `X-Processor-Secret: $PROCESSOR_SECRET`.

## Operations

- Health: `GET /health` → `{ ok: true, ts }`.
- Manually trigger outbound batch: `npm run process:once` (uses `PROCESSOR_SECRET`).
- Simulate inbound for local debugging: `npm run webhook:simulate +15551234567 "yes"`.
- Logs are JSON-per-line in production, human-friendly in dev.

## Onboarding a new company

Each company has their own Blooio API key, but they all share the same Piper
inbound webhook URL (set via `WEBHOOK_PUBLIC_URL`).

1. **Add the company in Airtable → Company Info** with their `Company ID`,
   `Business Name`, `Blooio API Key & Phone`, `Review/Booking/Membership Link`,
   handshake/payload templates per campaign.
2. **Register Blooio webhooks** so customer replies land in Piper:
   ```bash
   npm run blooio:setup                # registers for every company in Airtable
   npm run blooio:setup -- --company BUS-2   # just one
   ```
3. **Verify** with `npm run blooio:list`. Each company should show exactly one
   webhook pointing at `https://YOUR-API-HOST/webhook`.
4. **Clean up legacy webhooks** (e.g. previous Make.com / dev tunnel registrations):
   ```bash
   npm run blooio:cleanup              # dry-run: shows what would be deleted
   npm run blooio:cleanup -- --force   # actually delete
   ```

That's it. Customer texts YES → Blooio POSTs to Piper → Piper looks up the
campaign log, resolves which company by linked record, sends the payload using
that company's Blooio key.

## Environment variables

The only required vars are `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID`. Everything else has
sensible defaults documented in `.env.example`. The schema knobs default to the
"Universal CSV" base shape and only need overrides when a column or single-select option differs.
