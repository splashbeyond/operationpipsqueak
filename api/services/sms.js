require('../env');

const axios = require('axios');

function blooioBaseUrl() {
  const u = process.env.BLOOIO_BASE_URL || 'https://backend.blooio.com/v2/api';
  return u.replace(/\/$/, '');
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey Client Blooio API key (Bearer)
 * @param {string} opts.to E.164 recipient
 * @param {string} opts.text Message body
 * @param {string} [opts.idempotencyKey]
 */
async function sendSMS({ apiKey, to, text, idempotencyKey }) {
  if (!apiKey) throw new Error('sendSMS: apiKey is required');
  if (!to) throw new Error('sendSMS: to is required');
  const bodyText = text === undefined || text === null ? '' : String(text).trim();
  if (bodyText === '') {
    throw new Error(
      'Blooio: message text is empty. Fill the campaign template on Company Info (e.g. Review Template) or set PIPER_DEFAULT_SMS_TEMPLATE in .env.'
    );
  }

  const chatId = encodeURIComponent(to);
  const url = `${blooioBaseUrl()}/chats/${chatId}/messages`;

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const res = await axios.post(url, { text: bodyText }, { headers, validateStatus: () => true });

  if (res.status >= 400) {
    const msg =
      res.data && typeof res.data === 'object'
        ? JSON.stringify(res.data)
        : String(res.data || res.statusText);
    throw new Error(`Blooio error ${res.status}: ${msg}`);
  }

  return res.data;
}

module.exports = {
  sendSMS,
  blooioBaseUrl,
};
