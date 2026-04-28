/**
 * Dev-only HTTPS tunnel so Blooio can POST webhooks to your laptop.
 * Enabled with ENABLE_DEV_TUNNEL=1. Never enable in production.
 *
 * Use ngrok. Set NGROK_AUTHTOKEN, optionally NGROK_DOMAIN for a stable URL.
 * If NGROK_AUTHTOKEN is missing, the API still runs but inbound webhooks
 * cannot be received — we print loud instructions instead of pretending to work.
 *
 * To get a stable URL that survives restarts (free):
 *   1. Sign up: https://dashboard.ngrok.com/signup
 *   2. Token:   https://dashboard.ngrok.com/get-started/your-authtoken  → NGROK_AUTHTOKEN
 *   3. Domain:  https://dashboard.ngrok.com/cloud-edge/domains          → NGROK_DOMAIN
 *      (free tier includes one reserved domain like "piper-davis.ngrok-free.app")
 */

/** @type {{ close: () => Promise<void>; url: () => string } | null} */
let ngrokListener = null;

function box(lines) {
  const max = Math.max(...lines.map((l) => l.length));
  const bar = '═'.repeat(max + 4);
  console.log('\n' + bar);
  for (const l of lines) console.log(`  ${l.padEnd(max, ' ')}`);
  console.log(bar + '\n');
}

function printWebhookBanner(webhookUrl, isStable) {
  box([
    'Blooio → Webhooks → Inbound URL (message.received):',
    '',
    webhookUrl,
    '',
    isStable
      ? 'Stable domain. Paste once, leave it alone.'
      : 'EPHEMERAL: this URL changes on restart. Set NGROK_DOMAIN for a stable one.',
  ]);
}

function printNoTokenBanner() {
  box([
    'Inbound webhooks are NOT receivable yet.',
    '',
    'Set NGROK_AUTHTOKEN in .env (free):',
    '  https://dashboard.ngrok.com/get-started/your-authtoken',
    '',
    'Then optional, recommended:',
    '  NGROK_DOMAIN=<your>.ngrok-free.app  (one free reserved domain)',
    '',
    'Or deploy (render.yaml) and skip tunnels entirely.',
  ]);
}

/**
 * @param {number} port
 * @returns {Promise<string|null>} Public base URL (no trailing slash), or null if not started.
 */
async function startDevTunnel(port) {
  const token = String(process.env.NGROK_AUTHTOKEN || '').trim();
  const domain = String(process.env.NGROK_DOMAIN || '').trim();

  if (!token) {
    printNoTokenBanner();
    return null;
  }

  let ngrok;
  try {
    ngrok = require('@ngrok/ngrok');
  } catch {
    throw new Error('@ngrok/ngrok missing. Run: npm install');
  }

  /** @type {{ addr: number, authtoken: string, domain?: string }} */
  const opts = { addr: port, authtoken: token };
  if (domain) opts.domain = domain;

  let listener;
  try {
    listener = await ngrok.forward(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (domain && /domain|reserved|not allowed/i.test(msg)) {
      console.warn(
        `[piper] ngrok domain "${domain}" rejected (${msg}). Falling back to ephemeral URL. ` +
          'Reserve a free domain at https://dashboard.ngrok.com/cloud-edge/domains.'
      );
      delete opts.domain;
      listener = await ngrok.forward(opts);
    } else {
      throw err;
    }
  }

  ngrokListener = listener;
  const base = listener.url().replace(/\/$/, '');
  printWebhookBanner(`${base}/webhook`, Boolean(domain) && base.includes(domain));
  return base;
}

async function closeDevTunnel() {
  if (!ngrokListener) return;
  try {
    await ngrokListener.close();
  } catch {
    /* ignore */
  }
  ngrokListener = null;
  try {
    const ngrok = require('@ngrok/ngrok');
    await ngrok.disconnect();
  } catch {
    /* ignore */
  }
}

module.exports = { startDevTunnel, closeDevTunnel };
