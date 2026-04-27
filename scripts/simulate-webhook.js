#!/usr/bin/env node
/**
 * Simulate a Blooio message.received webhook for local testing.
 * Usage:
 *   node scripts/simulate-webhook.js +15550100199 "Yes please"
 * Env: API_URL (default http://127.0.0.1:PORT)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const port = process.env.PORT || 3000;
const base = (process.env.API_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');

async function main() {
  const phone = process.argv[2];
  const text = process.argv[3] || 'Test reply';
  if (!phone) {
    console.error('Usage: node scripts/simulate-webhook.js +15551234567 "message text"');
    process.exit(1);
  }

  const body = {
    event: 'message.received',
    message_id: 'sim_' + Date.now(),
    external_id: phone,
    text,
    attachments: [],
    protocol: 'imessage',
    timestamp: Date.now(),
    internal_id: '+15550000000',
    received_at: Date.now(),
    sender: phone,
    is_group: false,
  };

  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.text();
  console.log(res.status, out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
