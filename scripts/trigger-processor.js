#!/usr/bin/env node
/**
 * One-shot outbound processor (same work as cron POST /process).
 * Usage: node scripts/trigger-processor.js
 * Requires root .env: PROCESSOR_SECRET; optional API_URL (default http://127.0.0.1:PORT)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const port = process.env.PORT || 3000;
const base = (process.env.API_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const secret = process.env.PROCESSOR_SECRET;

async function main() {
  if (!secret || !String(secret).trim()) {
    console.error('Set PROCESSOR_SECRET in .env');
    process.exit(1);
  }
  const res = await fetch(`${base}/process`, {
    method: 'POST',
    headers: { 'X-Processor-Secret': secret },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    console.error(res.status, json);
    process.exit(1);
  }
  console.log(json);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
