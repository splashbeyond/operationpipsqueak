# Piper — testing checklist

Use this after configuring **root** `.env` (API) and **`frontend/.env`** (`VITE_API_URL`). Replace URLs, IDs, and secrets with your values.

## Quick start (local)

- [ ] Root: copy `.env.example` → `.env` and fill secrets (at minimum Airtable + `PROCESSOR_SECRET` for scripts).
- [ ] Frontend: copy `frontend/.env.example` → `frontend/.env` and set `VITE_API_URL=http://localhost:3000` (or your API URL).
- [ ] From repo root: **`npm run dev:all`** — runs API (`nodemon`) and Vite together. Or run `npm run dev` and `cd frontend && npm run dev` in two terminals.

## Environment

- [ ] **API** — `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `OPENAI_API_KEY`, `BLOOIO_BASE_URL`, `PORT`, `PROCESSOR_SECRET` set in project root `.env`.
- [ ] **Frontend** — `frontend/.env` with `VITE_API_URL` pointing at the API (e.g. `http://localhost:3000` or your Vercel URL). Restart `npm run dev` after changes.
- [ ] **Airtable** — Tables and field names match what `api/services/airtable.js` and `api/routes/campaigns.js` expect (`Company Info`, `Uploads` with `Company` link, `Customer Data`, `Campaign Logs`, `Global DNC`).
- [ ] **Message History (optional)** — To log inbound/outbound lines from the webhook, add a table (e.g. **Message History**) with **Company ID**, **Phone**, **Direction** (single line or single select: Inbound / Outbound), **Body** (long text), **Event** (optional, single line). Set `AIRTABLE_MESSAGE_HISTORY_TABLE=Message History` in root `.env`. If unset, logging is skipped.

## Backend — local

- [ ] From repo root: `npm start` (or `npm run dev`). No crash on boot.
- [ ] `GET http://localhost:3000/health` returns `{ "ok": true }`.
- [ ] **Processor** — Inline loop runs unless `VERCEL=1` or `DISABLE_INLINE_PROCESSOR=1`. Logs show `[processor]` lines within ~60s if `Awaiting` rows exist.

## Upload & CSV

- [ ] Use **`fixtures/sample-leads.csv`** or your own file (name / phone / campaign columns, or rely on GPT mapping + overrides).
- [ ] `POST /upload` as `multipart/form-data` with `file`, `companyId`, optional `batchName`, optional `campaignType` (or use the **Upload** page).
- [ ] **Airtable** — New **Uploads** row: `Pending` → `Done` (or `Failed` on error).
- [ ] **Customer Data** — Expected rows created; `Status` = `Awaiting`; DNC phones skipped.
- [ ] **Global DNC** — Add a test number; confirm upload skips it and UI shows skipped count.

## Outbound

- [ ] With at least one **Customer Data** row in `Awaiting`, wait for the inline processor (~60s) **or** run **`npm run process:once`** (same as `POST /process` with `X-Processor-Secret`). Optional: set `API_URL` in `.env` if the API is not on `127.0.0.1:$PORT`.
- [ ] **Blooio** — Message received; **Customer Data** → `Sent` (or `Failed` with logs if misconfigured).
- [ ] **Campaign Logs** — New row with `Sent` and correct phone / campaign / batch.
- [ ] **Vercel / cron** — If deployed, `VERCEL=1` disables inline processor. Schedule **POST** `{API}/process` every ~60s with header `X-Processor-Secret: <PROCESSOR_SECRET>`. Expect `200` and `{ "ok": true, "processed": n }`.

## Inbound webhook

- [ ] Point Blooio webhook to **`{API}/webhook`**. Payloads use **`message.received`** with **`sender`**, **`text`**, **`external_id`** (see [Blooio webhook events](https://docs.blooio.com/api-reference/webhook-events)). Other event types (e.g. `message.sent`) return **200** with `{ "ignored": "..." }` and are not treated as customer replies.
- [ ] **Local simulation** (no Blooio): after a campaign log exists for a phone, run  
  `npm run webhook:simulate -- +15550100199 "Yes please"`  
  Use the same E.164 as in **Campaign Logs** / **Customer Data**. Add `--` before args. Set `API_URL` in `.env` if needed.
- [ ] Reply to a real message (or simulate); **Campaign Logs** moves through `Replied` → `Payload Sent` (or check Airtable fields you update).
- [ ] Owner notification / follow-up sends if templates and `Owner Mobile` are set (watch Blooio + Airtable).
- [ ] If **Message History** is configured, new **Inbound** / **Outbound** rows appear for the webhook flow.

## Dashboard (frontend)

- [ ] From `frontend/`: `npm run dev`. Open the app; no console errors on navigation.
- [ ] **Company ID** in header persists (localStorage) and is sent with API calls.
- [ ] **Upload** — Drag/drop or pick CSV; success panel shows imported / DNC skipped / totals.
- [ ] **Campaigns** — Stats and log table load; status filter works; dates show when Airtable returns `createdAt`.
- [ ] **Batches** — Batches list loads; expand a row; customer table matches **Customer Data** for that batch key.

## Production (optional)

- [ ] API deployed (e.g. Vercel); env vars set including `PROCESSOR_SECRET`.
- [ ] Cron hits `/process` with secret; Blooio webhook URL is the **HTTPS** API + `/webhook`.
- [ ] `frontend` build: `cd frontend && npm run build`; host `dist/` or connect preview to same `VITE_API_URL` as production API.

## Regression quick pass

- [ ] Change **Company ID** in the header — data switches to the other tenant’s logs/batches (still no auth; treat URL as trusted).
- [ ] **CORS** — If the UI is on another origin, confirm API `cors()` allows it or use a proxy.

---

**Note:** Campaign log rows do not include customer name in the API yet; the Campaigns table shows **Name** as `—` unless you extend the backend/Airtable schema.
