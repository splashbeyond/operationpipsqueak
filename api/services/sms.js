/**
 * Blooio SMS sender.
 * @see https://docs.blooio.com/api-reference/messages
 */

const axios = require('axios');
const { SERVER } = require('../config');

/**
 * @param {object} opts
 * @param {string} opts.apiKey Bearer token for the company's Blooio API key
 * @param {string} opts.to Recipient (E.164 — e.g. "+14155551234")
 * @param {string} opts.text Message body (must be non-empty)
 * @param {string} [opts.idempotencyKey] Prevents duplicate sends on retry
 */
async function sendSMS({ apiKey, to, text, idempotencyKey }) {
  if (!apiKey) throw new Error('sendSMS: apiKey is required');
  if (!to) throw new Error('sendSMS: to is required');
  const body = String(text || '').trim();
  if (!body) throw new Error('sendSMS: empty body — Blooio rejects empty messages');

  const url = `${SERVER.blooioBaseUrl}/chats/${encodeURIComponent(to)}/messages`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await axios.post(url, { text: body }, { headers, validateStatus: () => true });
  if (res.status >= 400) {
    const msg =
      typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data || res.statusText);
    const err = new Error(`Blooio error ${res.status}: ${msg}`);
    /** @type {any} */ (err).response = { status: res.status, data: res.data };
    throw err;
  }
  return res.data;
}

module.exports = { sendSMS };
