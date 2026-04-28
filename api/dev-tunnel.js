/**
 * HTTPS tunnel so Blooio can POST webhooks to a dev machine.
 * Enable with ENABLE_DEV_TUNNEL=1 — devDependencies only; never enable in production.
 *
 * Prefer NGROK_AUTHTOKEN (ngrok) — works with third-party webhooks.
 * localtunnel (*.loca.lt) often fails for inbound SMS/webhook providers.
 */

let tunnelRef = null;
/** @type {{ close: () => Promise<void>; url: () => string } | null} */
let ngrokListener = null;

function printWebhookBanner(webhookUrl) {
  console.log('\n');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  BLOOIO → Webhooks: set Inbound URL to (message.received):');
  console.log('');
  console.log(`  ${webhookUrl}`);
  console.log('');
  console.log('  Copy exactly, save in Blooio, then text YES again.');
  console.log('  Production: use your deployed https://your-domain/webhook (no tunnel).');
  console.log('══════════════════════════════════════════════════════════════\n');
}

/**
 * @param {number} port
 * @returns {Promise<string>} Public base URL (no trailing slash)
 */
async function startDevTunnel(port) {
  const token = process.env.NGROK_AUTHTOKEN;
  if (token != null && String(token).trim() !== '') {
    let ngrok;
    try {
      ngrok = require('@ngrok/ngrok');
    } catch {
      throw new Error('@ngrok/ngrok is missing. From the repo root run: npm install');
    }
    const listener = await ngrok.forward({
      addr: port,
      authtoken: String(token).trim(),
    });
    ngrokListener = listener;
    const base = listener.url().replace(/\/$/, '');
    printWebhookBanner(`${base}/webhook`);
    console.log('[piper] Using ngrok (NGROK_AUTHTOKEN set) — reliable for Blooio webhooks.\n');
    return base;
  }

  console.warn(
    '[piper] NGROK_AUTHTOKEN is not set — falling back to localtunnel (*.loca.lt).\n' +
      '      Many providers never reach loca.lt (or hit an interstitial). For inbound SMS:\n' +
      '      1) Sign up at https://dashboard.ngrok.com/signup\n' +
      '      2) Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken\n' +
      '      3) Add to .env: NGROK_AUTHTOKEN=...  then restart npm run dev:tunnel\n'
  );

  let localtunnel;
  try {
    localtunnel = require('localtunnel');
  } catch {
    throw new Error('localtunnel is missing. From the repo root run: npm install');
  }

  const subdomain = process.env.DEV_TUNNEL_SUBDOMAIN;
  const tunnel = await localtunnel({
    port,
    ...(subdomain && String(subdomain).trim() ? { subdomain: String(subdomain).trim() } : {}),
  });

  tunnelRef = tunnel;
  tunnel.on('error', (err) => {
    console.error('[piper] dev tunnel error:', err.message || err);
  });

  const base = tunnel.url.replace(/\/$/, '');
  printWebhookBanner(`${base}/webhook`);
  return base;
}

async function closeDevTunnel() {
  if (ngrokListener) {
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
  if (tunnelRef) {
    try {
      tunnelRef.close();
    } catch {
      /* ignore */
    }
    tunnelRef = null;
  }
}

module.exports = {
  startDevTunnel,
  closeDevTunnel,
};
