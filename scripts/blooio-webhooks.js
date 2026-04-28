#!/usr/bin/env node
/**
 * Manage Blooio inbound webhooks across all companies in Airtable.
 *
 * Why: Blooio has no dashboard UI for webhooks; they're configured per API key
 * via the REST API. Each company in Piper has their own Blooio key, but all
 * webhooks should point at one canonical Piper URL.
 *
 * Usage:
 *   node scripts/blooio-webhooks.js list
 *   node scripts/blooio-webhooks.js setup
 *   node scripts/blooio-webhooks.js cleanup        # remove webhooks NOT pointing at our URL
 *   node scripts/blooio-webhooks.js setup --company BUS-1
 *   node scripts/blooio-webhooks.js setup --url https://piper-api-l6dz.onrender.com
 *
 * Env required:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 *   WEBHOOK_PUBLIC_URL (or pass --url) — e.g. https://piper-api-l6dz.onrender.com
 *   BLOOIO_BASE_URL (defaults to https://backend.blooio.com/v2/api)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Airtable = require('airtable');

const TABLES = {
  companyInfo: process.env.AIRTABLE_COMPANY_INFO_TABLE || 'Company Info',
};

const BLOOIO_BASE = (process.env.BLOOIO_BASE_URL || 'https://backend.blooio.com/v2/api').replace(
  /\/$/,
  ''
);

function parseArgs(argv) {
  const args = { cmd: argv[2], company: null, url: null, force: false };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--company') args.company = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--force') args.force = true;
  }
  return args;
}

function fail(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function getBase() {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    fail('AIRTABLE_API_KEY and AIRTABLE_BASE_ID are required.');
  }
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  return Airtable.base(process.env.AIRTABLE_BASE_ID);
}

function escFormula(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parseBlooioKey(combined) {
  const s = String(combined || '').trim();
  if (!s) return '';
  if (s.includes('\n')) return s.split('\n')[0].trim();
  if (s.includes('|')) return s.split('|')[0].trim();
  return s;
}

async function fetchCompanies(base, onlyCompanyId) {
  const records = onlyCompanyId
    ? await base(TABLES.companyInfo)
        .select({ filterByFormula: `{Company ID} = '${escFormula(onlyCompanyId)}'`, maxRecords: 1 })
        .firstPage()
    : await base(TABLES.companyInfo).select({ maxRecords: 200 }).firstPage();

  const credField =
    process.env.AIRTABLE_COMPANY_BLOOIO_CREDENTIALS_FIELD || 'Blooio API Key & Phone';

  return records
    .map((r) => {
      const combined = r.get(credField);
      const legacyKey = r.get('Blooio API Key');
      const apiKey = String(legacyKey || '').trim() || parseBlooioKey(combined);
      return {
        recordId: r.id,
        companyId: String(r.get('Company ID') || '').trim(),
        businessName: String(r.get('Business Name') || '').trim(),
        apiKey,
      };
    })
    .filter((c) => c.companyId);
}

async function bloo(method, path, apiKey, body) {
  const res = await fetch(`${BLOOIO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Blooio ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function extractWebhookList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.webhooks)) return data.webhooks;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function listForCompany(c) {
  if (!c.apiKey) {
    console.log(`  ${c.companyId.padEnd(8)}  (no Blooio API key — skipping)`);
    return [];
  }
  try {
    const data = await bloo('GET', '/webhooks', c.apiKey);
    const list = extractWebhookList(data);
    if (!list.length) {
      console.log(`  ${c.companyId.padEnd(8)}  (none registered)`);
      return [];
    }
    for (const w of list) {
      const id = w.id || w._id || w.webhook_id || '?';
      const url = w.webhook_url || w.url || '?';
      const type = w.webhook_type || w.type || '?';
      console.log(`  ${c.companyId.padEnd(8)}  [${type}] ${url}  (id: ${id})`);
    }
    return list;
  } catch (err) {
    console.log(`  ${c.companyId.padEnd(8)}  ERROR: ${err.message}`);
    return [];
  }
}

async function setupForCompany(c, targetUrl) {
  if (!c.apiKey) {
    console.log(`  ${c.companyId.padEnd(8)}  SKIP (no Blooio API key in Airtable)`);
    return;
  }

  let existing;
  try {
    existing = extractWebhookList(await bloo('GET', '/webhooks', c.apiKey));
  } catch (err) {
    console.log(`  ${c.companyId.padEnd(8)}  list failed: ${err.message}`);
    return;
  }

  const matching = existing.filter((w) => {
    const url = w.webhook_url || w.url || '';
    return url === targetUrl;
  });

  if (matching.length) {
    console.log(`  ${c.companyId.padEnd(8)}  OK (already pointing at ${targetUrl})`);
    return;
  }

  try {
    const created = await bloo('POST', '/webhooks', c.apiKey, {
      webhook_url: targetUrl,
      webhook_type: 'message',
    });
    const id = created?.id || created?._id || created?.webhook_id || '?';
    console.log(`  ${c.companyId.padEnd(8)}  REGISTERED (id: ${id}) → ${targetUrl}`);
  } catch (err) {
    console.log(`  ${c.companyId.padEnd(8)}  REGISTER FAILED: ${err.message}`);
  }
}

async function cleanupForCompany(c, targetUrl, force) {
  if (!c.apiKey) {
    console.log(`  ${c.companyId.padEnd(8)}  SKIP (no Blooio API key)`);
    return;
  }
  let existing;
  try {
    existing = extractWebhookList(await bloo('GET', '/webhooks', c.apiKey));
  } catch (err) {
    console.log(`  ${c.companyId.padEnd(8)}  list failed: ${err.message}`);
    return;
  }
  const stale = existing.filter((w) => {
    const url = w.webhook_url || w.url || '';
    return url !== targetUrl;
  });
  if (!stale.length) {
    console.log(`  ${c.companyId.padEnd(8)}  clean (only ${targetUrl} registered)`);
    return;
  }
  for (const w of stale) {
    const id = w.id || w._id || w.webhook_id;
    const url = w.webhook_url || w.url;
    if (!id) {
      console.log(`  ${c.companyId.padEnd(8)}  cannot delete (no id) — ${url}`);
      continue;
    }
    if (!force) {
      console.log(`  ${c.companyId.padEnd(8)}  WOULD DELETE ${url}  (id: ${id})`);
      continue;
    }
    try {
      await bloo('DELETE', `/webhooks/${encodeURIComponent(id)}`, c.apiKey);
      console.log(`  ${c.companyId.padEnd(8)}  DELETED ${url}  (id: ${id})`);
    } catch (err) {
      console.log(`  ${c.companyId.padEnd(8)}  delete failed: ${err.message}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const targetUrl = (args.url || process.env.WEBHOOK_PUBLIC_URL || '').replace(/\/$/, '') + '/webhook';
  const cmd = args.cmd;

  if (!cmd || ['help', '-h', '--help'].includes(cmd)) {
    console.log(
      [
        'Usage:',
        '  node scripts/blooio-webhooks.js list                    # list webhooks per company',
        '  node scripts/blooio-webhooks.js setup                   # ensure each company points at WEBHOOK_PUBLIC_URL/webhook',
        '  node scripts/blooio-webhooks.js cleanup                 # show stale webhooks (use --force to delete)',
        '  Flags: --company BUS-1   --url https://host   --force',
      ].join('\n')
    );
    process.exit(0);
  }

  if (['setup', 'cleanup'].includes(cmd) && !args.url && !process.env.WEBHOOK_PUBLIC_URL) {
    fail('WEBHOOK_PUBLIC_URL not set. Add it to .env or pass --url https://your-host');
  }

  const base = getBase();
  const companies = await fetchCompanies(base, args.company);
  if (!companies.length) {
    fail(args.company ? `Company not found: ${args.company}` : 'No Company Info rows found');
  }

  console.log(`\nBlooio base: ${BLOOIO_BASE}`);
  if (cmd !== 'list') console.log(`Target URL : ${targetUrl}`);
  console.log(`Companies  : ${companies.length}\n`);

  if (cmd === 'list') {
    for (const c of companies) await listForCompany(c);
  } else if (cmd === 'setup') {
    for (const c of companies) await setupForCompany(c, targetUrl);
  } else if (cmd === 'cleanup') {
    for (const c of companies) await cleanupForCompany(c, targetUrl, args.force);
    if (!args.force) {
      console.log('\n(dry run — re-run with --force to actually delete)');
    }
  } else {
    fail(`Unknown command: ${cmd}`);
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
