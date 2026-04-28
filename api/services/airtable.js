/**
 * Airtable data layer.
 *
 * Schema is locked to the Piper "Universal CSV" base shape via config.js.
 * Tables: Company Info, Customer Data, Campaign Logs, Uploads, Global DNC.
 */

const Airtable = require('airtable');
const axios = require('axios');

const {
  TABLES,
  FIELDS,
  STATUS,
  OPTIONS,
  campaignKey,
  customerCampaignLabel,
  assertCoreEnv,
} = require('../config');
const { logger } = require('../log');

const log = logger('airtable');

let _base;

function getBase() {
  if (_base) return _base;
  assertCoreEnv();
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  _base = Airtable.base(process.env.AIRTABLE_BASE_ID);
  return _base;
}

/* ───────────────────────── helpers ───────────────────────── */

function escFormula(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function recordCreatedMs(record) {
  const t = record._rawJson?.createdTime;
  return t ? Date.parse(t) || 0 : 0;
}

/** E.164 + national digit variants — used for inbound phone lookups. */
function phoneVariants(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  const out = new Set();
  if (raw) out.add(raw);
  if (digits.length === 10) {
    out.add(`+1${digits}`);
    out.add(digits);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    out.add(`+${digits}`);
    out.add(digits);
    out.add(digits.slice(1));
  }
  return [...out];
}

/** Last 10 digits for FIND-style match (handles any phone formatting). */
function last10(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/* ───────────────────────── company info ───────────────────────── */

function parseBlooioCredsCombined(combined) {
  const s = String(combined || '').trim();
  if (!s) return { apiKey: '', phoneNumber: '' };
  if (s.includes('\n')) {
    const [first, ...rest] = s.split('\n');
    return { apiKey: first.trim(), phoneNumber: rest.join('\n').trim() };
  }
  if (s.includes('|')) {
    const [first, ...rest] = s.split('|').map((x) => x.trim());
    return { apiKey: first || s, phoneNumber: rest.join('|').trim() };
  }
  return { apiKey: s, phoneNumber: '' };
}

/** First non-empty string from record fields (tries alternate Airtable header spellings). */
function fieldFirst(r, ...fieldNames) {
  for (const name of fieldNames) {
    const v = r.get(name);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function companyInfoFromRecord(r) {
  const credCombined = r.get(
    process.env.AIRTABLE_COMPANY_BLOOIO_CREDENTIALS_FIELD || 'Blooio API Key & Phone'
  );
  const legacyKey = r.get('Blooio API Key');
  const explicitPhone = r.get('Blooio Phone Number') ?? r.get('Blooio Phone');
  let { apiKey: blooioApiKey, phoneNumber: blooioPhoneNumber } = parseBlooioCredsCombined(
    credCombined
  );
  if (legacyKey) blooioApiKey = legacyKey;
  if (explicitPhone) blooioPhoneNumber = explicitPhone;

  return {
    recordId: r.id,
    companyId: r.get('Company ID'),
    businessName: r.get('Business Name') || '',
    blooioApiKey: blooioApiKey || '',
    blooioPhoneNumber: blooioPhoneNumber || '',

    // Templates (campaign-specific + global fallbacks).
    handshakeMatrix: r.get('Handshake Matrix') || '',
    payloadMatrixReward: r.get('Payload Matrix (Reward)') || '',
    payloadMatrixNoReward: r.get('Payload Matrix (No Reward)') || '',
    inboundReminderTemplate: r.get('Inbound Reminder') || '',

    handshake: {
      review: {
        reward: r.get('Handshake: Review (Reward)') || '',
        noReward: r.get('Handshake: Review (No Reward)') || '',
      },
      no_show: {
        reward: fieldFirst(
          r,
          'Handshake: No-Show (Reward)',
          'Handshake: No Show (Reward)'
        ),
        noReward: fieldFirst(
          r,
          'Handshake: No-Show (No Reward)',
          'Handshake: No Show (No Reward)'
        ),
      },
      cancellation: {
        reward: r.get('Handshake: Cancellation (Reward)') || '',
        noReward: r.get('Handshake: Cancellation (No Reward)') || '',
      },
      reactivation: {
        reward: r.get('Handshake: Reactivation (Reward)') || '',
        noReward: r.get('Handshake: Reactivation (No Reward)') || '',
      },
      referral: {
        reward: r.get('Handshake: Referral (Reward)') || '',
        noReward: r.get('Handshake: Referral (No Reward)') || '',
      },
      upsell: {
        reward: r.get('Handshake: Upsell (Reward)') || '',
        noReward: r.get('Handshake: Upsell (No Reward)') || '',
      },
    },
    payload: {
      review: {
        reward: r.get('Payload: Review (Reward)') || '',
        noReward: r.get('Payload: Review (No Reward)') || '',
      },
      no_show: {
        reward: fieldFirst(
          r,
          'Payload: Booking (Reward)',
          'Payload: No-Show (Reward)',
          'Payload: No Show (Reward)'
        ),
        noReward: fieldFirst(
          r,
          'Payload: Booking (No Reward)',
          'Payload: No-Show (No Reward)',
          'Payload: No Show (No Reward)'
        ),
      },
      cancellation: {
        reward: r.get('Payload: Cancellation (Reward)') || '',
        noReward: r.get('Payload: Cancellation (No Reward)') || '',
      },
      reactivation: {
        reward: r.get('Payload: Reactivation (Reward)') || '',
        noReward: r.get('Payload: Reactivation (No Reward)') || '',
      },
      referral: {
        reward: r.get('Payload: Referral (Reward)') || '',
        noReward: r.get('Payload: Referral (No Reward)') || '',
      },
      upsell: {
        reward: r.get('Payload: Upsell (Reward)') || '',
        noReward: r.get('Payload: Upsell (No Reward)') || '',
      },
    },

    bookingLink: r.get('Booking Link') || '',
    reviewLink: r.get('Review Link') || '',
    membershipLink: r.get('Membership Link') || r.get('Upsell Link') || '',
    ownerMobile: r.get('Owner Mobile') || '',
  };
}

/** @param {string} companyId Company Info "Company ID" text or a record id (rec…) */
async function getCompanyInfo(companyId) {
  const id = String(companyId || '').trim();
  if (!id) return null;
  const b = getBase();

  if (id.startsWith('rec')) {
    try {
      const r = await b(TABLES.companyInfo).find(id);
      return companyInfoFromRecord(r);
    } catch {
      // Not a Company Info record id — fall through to text search.
    }
  }
  const records = await b(TABLES.companyInfo)
    .select({ filterByFormula: `{Company ID} = '${escFormula(id)}'`, maxRecords: 1 })
    .firstPage();
  return records.length ? companyInfoFromRecord(records[0]) : null;
}

/* ───────────────────────── uploads ───────────────────────── */

/**
 * @param {string} companyId
 * @param {string} [batchName]
 * @param {{ reward?: string }} [options]
 */
async function createUploadRecord(companyId, batchName, options = {}) {
  const company = await getCompanyInfo(companyId);
  if (!company) {
    throw new Error(
      `Company not found: ${companyId}. Add or fix a row in "Company Info" with Company ID = ${companyId}.`
    );
  }

  const F = FIELDS.upload;
  /** @type {Record<string, unknown>} */
  const fields = { [F.status]: STATUS.upload.initial };

  const trimmedBatch =
    batchName != null && String(batchName).trim() !== '' ? String(batchName).trim() : '';

  // Friendly name from the dashboard (your base often uses an auto / formula "Batch ID").
  if (!OPTIONS.uploadOmitBatchName && F.batchName && trimmedBatch) {
    fields[F.batchName] = trimmedBatch;
  }

  if (!OPTIONS.uploadOmitBatchId && trimmedBatch) {
    fields[F.batchId] = trimmedBatch;
  }

  const reward =
    options.reward !== undefined && options.reward !== null
      ? String(options.reward).trim()
      : '';
  if (F.rewardField && reward) {
    fields[F.rewardField] = reward;
  }

  const b = getBase();
  if (!OPTIONS.uploadSkipCompanyLink && F.companyLink) {
    try {
      const created = await b(TABLES.uploads).create([
        { fields: { ...fields, [F.companyLink]: [company.recordId] } },
      ]);
      return created[0].id;
    } catch (err) {
      log.warn('uploads create with link field failed, retrying with text Company ID', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!OPTIONS.uploadOmitCompanyIdText && F.companyId) {
    fields[F.companyId] = companyId;
  }
  const created = await b(TABLES.uploads).create([{ fields }]);
  return created[0].id;
}

/**
 * @param {string} recordId
 * @param {string} status
 * @param {Record<string, unknown>} [extraFields] e.g. Total Leads count
 */
async function updateUploadStatus(recordId, status, extraFields = {}) {
  const F = FIELDS.upload;
  /** @type {Record<string, unknown>} */
  let fields = { [F.status]: status, ...extraFields };
  for (;;) {
    try {
      await getBase()(TABLES.uploads).update([{ id: recordId, fields }]);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/Unknown field name:\s*"([^"]+)"/i);
      if (!m) throw err;
      const bad = m[1];
      if (!(bad in fields)) throw err;
      delete fields[bad];
      if (!Object.keys(fields).length) return;
    }
  }
}

/* ───────────────────────── customer data ───────────────────────── */

/**
 * @param {{ name: string, phone: string, campaignType: string, companyId: string, batchId?: string, reward?: string }} data
 */
async function createCustomerRecord(data) {
  const company = await getCompanyInfo(data.companyId);
  if (!company) {
    throw new Error(
      `Company not found for Customer Data: ${data.companyId}. Add a Company Info row with that Company ID.`
    );
  }

  const CF = FIELDS.customer;
  const fields = {
    [CF.name]: data.name,
    [CF.phone]: data.phone,
    [CF.status]: STATUS.customer.awaiting,
    [CF.companyId]: OPTIONS.customerCompanyIdIsLink ? [company.recordId] : data.companyId,
  };
  if (!OPTIONS.customerOmitCampaignOnCreate) {
    fields[CF.campaign] = customerCampaignLabel(data.campaignType);
  }
  if (
    !OPTIONS.customerOmitBatchId &&
    data.batchId !== undefined &&
    data.batchId !== null &&
    data.batchId !== ''
  ) {
    fields[CF.batchId] = data.batchId;
  }
  if (
    !OPTIONS.customerOmitReward &&
    data.reward !== undefined &&
    data.reward !== null &&
    String(data.reward).trim() !== ''
  ) {
    fields[CF.reward] = String(data.reward).trim();
  }

  const created = await getBase()(TABLES.customerData).create([{ fields }]);
  return created[0].id;
}

async function getAwaitingCustomers(limit = 25) {
  const CF = FIELDS.customer;
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const records = await getBase()(TABLES.customerData)
    .select({
      filterByFormula: `{${CF.status}} = '${escFormula(STATUS.customer.awaiting)}'`,
      maxRecords: safeLimit,
    })
    .firstPage();

  /** @type {{ id:string, name:any, phone:any, campaignType:any, companyId:string, batchId:any, status:any, reward:any }[]} */
  const out = [];
  for (const r of records) {
    let raw = r.get(CF.companyId);
    if (Array.isArray(raw)) raw = raw[0] ?? '';
    let companyIdValue = String(raw || '');
    if (companyIdValue.startsWith('rec')) {
      const info = await getCompanyInfo(companyIdValue);
      if (info?.companyId) companyIdValue = String(info.companyId);
    }
    out.push({
      id: r.id,
      name: r.get(CF.name),
      phone: r.get(CF.phone),
      campaignType: r.get(CF.campaign),
      companyId: companyIdValue,
      batchId: r.get(CF.batchId),
      status: r.get(CF.status),
      reward: r.get(CF.reward),
    });
  }
  return out;
}

async function updateCustomerStatus(recordId, status) {
  await getBase()(TABLES.customerData).update([
    { id: recordId, fields: { [FIELDS.customer.status]: status } },
  ]);
}

/**
 * Latest Customer Data row for a phone (filtered to a specific company).
 * Used by webhook to build the inbound payload (Reward + Name placeholders).
 *
 * @param {string} companyIdText e.g. "BUS-1"
 * @param {string} phone
 * @param {ReturnType<typeof companyInfoFromRecord> | null | undefined} [preloadedCompany]
 */
async function getLatestCustomerForCompanyPhone(companyIdText, phone, preloadedCompany) {
  const CF = FIELDS.customer;
  const variants = phoneVariants(phone);
  if (!variants.length) return null;

  const company = preloadedCompany || (await getCompanyInfo(companyIdText));
  if (!company) return null;
  const wanted = String(company.companyId || companyIdText).trim();

  const phoneClauses = variants.map((v) => `{${CF.phone}} = '${escFormula(v)}'`);
  const formula = phoneClauses.length === 1 ? phoneClauses[0] : `OR(${phoneClauses.join(', ')})`;

  const records = await getBase()(TABLES.customerData)
    .select({ filterByFormula: formula, maxRecords: 100 })
    .firstPage();
  if (!records.length) return null;

  /** @type {import('airtable').Record<any>[]} */
  const matched = [];
  for (const r of records) {
    let raw = r.get(CF.companyId);
    if (Array.isArray(raw)) raw = raw[0] ?? '';
    let cid = String(raw || '').trim();
    if (cid.startsWith('rec')) {
      const info = await getCompanyInfo(cid);
      cid = info?.companyId ? String(info.companyId).trim() : cid;
    }
    if (cid === wanted) matched.push(r);
  }
  if (!matched.length) return null;

  matched.sort((a, b) => recordCreatedMs(b) - recordCreatedMs(a));
  const r = matched[0];
  return { id: r.id, name: r.get(CF.name), reward: r.get(CF.reward) };
}

function customerRewardDisplayText(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'boolean') return raw ? 'Yes' : '';
  return String(raw).trim();
}

/* ───────────────────────── DNC ───────────────────────── */

async function checkDNC(phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return false;
  const clauses = variants.map(
    (v) => `{${FIELDS.globalDnc.phone}} = '${escFormula(v)}'`
  );
  const formula = clauses.length === 1 ? clauses[0] : `OR(${clauses.join(', ')})`;
  try {
    const records = await getBase()(TABLES.globalDnc)
      .select({ filterByFormula: formula, maxRecords: 1 })
      .firstPage();
    return records.length > 0;
  } catch (err) {
    log.warn('checkDNC failed (treating as not on DNC)', {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/* ───────────────────────── campaign logs ───────────────────────── */

/**
 * Create a Campaign Logs row. On the first INVALID/UNKNOWN error, retries once
 * after dropping optional fields (Snapshot, Target Payload) — anything else throws.
 *
 * @param {{
 *   companyId: string, phone: string, campaignType: string, status: string,
 *   batchId?: string, snapshotLinks?: string, messageBody?: string, handshakeSentAt?: string
 * }} data
 * @returns {Promise<string|null>}
 */
async function createCampaignLog(data) {
  const F = FIELDS.log;

  /** @type {Record<string, unknown>} */
  const fields = {
    [F.phone]: data.phone,
    [F.status]: data.status,
  };

  if (OPTIONS.logCompanyIdIsLink) {
    const company = await getCompanyInfo(data.companyId);
    if (!company) {
      throw new Error(
        `Company not found for Campaign Logs: ${data.companyId}. Cannot write linked Company ID.`
      );
    }
    fields[F.companyId] = [company.recordId];
  } else {
    fields[F.companyId] = data.companyId;
  }

  if (!OPTIONS.logOmitCampaign) {
    fields[F.campaign] = customerCampaignLabel(data.campaignType);
  }
  if (
    !OPTIONS.logOmitBatchId &&
    data.batchId != null &&
    String(data.batchId).trim() !== ''
  ) {
    fields[F.batchId] = data.batchId;
  }
  if (data.snapshotLinks && F.snapshotLinks) {
    fields[F.snapshotLinks] = String(data.snapshotLinks).trim();
  }
  if (
    !OPTIONS.logOmitTargetPayload &&
    data.messageBody &&
    String(data.messageBody).trim() !== ''
  ) {
    fields[F.targetPayload] = String(data.messageBody).trim().slice(0, 100000);
  }
  if (data.handshakeSentAt) {
    fields[F.handshakeSentAt] = String(data.handshakeSentAt).trim();
  }

  const b = getBase();
  try {
    const created = await b(TABLES.campaignLogs).create([{ fields }]);
    return created[0].id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/INVALID_VALUE_FOR_COLUMN|UNKNOWN_FIELD_NAME|cannot accept|cell value/i.test(msg)) {
      throw err;
    }
    // Retry once with only the essentials.
    const minimal = {
      [F.companyId]: fields[F.companyId],
      [F.phone]: data.phone,
      [F.status]: data.status,
    };
    if (!OPTIONS.logOmitCampaign) minimal[F.campaign] = customerCampaignLabel(data.campaignType);
    if (data.handshakeSentAt) minimal[F.handshakeSentAt] = String(data.handshakeSentAt).trim();

    log.warn('createCampaignLog retrying minimal', { err: msg });
    try {
      const created = await b(TABLES.campaignLogs).create([{ fields: minimal }]);
      return created[0].id;
    } catch (err2) {
      log.error('createCampaignLog minimal retry failed', {
        err: err2 instanceof Error ? err2.message : String(err2),
        fields: Object.keys(minimal),
      });
      return null;
    }
  }
}

async function updateCampaignLog(recordId, data) {
  await getBase()(TABLES.campaignLogs).update([{ id: recordId, fields: data }]);
}

async function campaignLogRecordToLog(r) {
  const F = FIELDS.log;
  let companyId = '';
  /** @type {ReturnType<typeof companyInfoFromRecord> | undefined} */
  let companyInfoPreloaded;

  const cid = r.get(F.companyId);
  if (Array.isArray(cid)) {
    const rid = cid[0] ?? '';
    if (String(rid).startsWith('rec')) {
      const info = await getCompanyInfo(String(rid));
      companyInfoPreloaded = info || undefined;
      companyId = info?.companyId ? String(info.companyId) : String(rid);
    } else {
      companyId = String(rid || '');
    }
  } else if (cid != null && cid !== '') {
    companyId = String(cid);
  }

  return {
    id: r.id,
    companyId,
    phone: String(r.get(F.phone) ?? ''),
    campaignType: r.get(F.campaign),
    status: r.get(F.status),
    batchId: r.get(F.batchId),
    snapshotLinks: r.get(F.snapshotLinks),
    targetPayload: r.get(F.targetPayload),
    latestReply: r.get(F.latestReply),
    companyInfo: companyInfoPreloaded,
  };
}

/**
 * Find the most recent Campaign Logs row for an inbound phone, optionally
 * scoped to a specific Company Info record (avoids cross-company collisions
 * when the same number exists in multiple companies' logs).
 *
 * Strategy (cheap → robust):
 *   1. Equality on the phone field with E.164/national variants.
 *   2. FIND on last 10 digits (handles +1, punctuation, extensions, etc.).
 *
 * @param {string} phone
 * @param {string} [companyRecordId] Optional Company Info record id (rec…) to scope the search.
 */
async function getCampaignLogByPhone(phone, companyRecordId) {
  const F = FIELDS.log;
  const variants = phoneVariants(phone);
  if (!variants.length) return null;

  const b = getBase();
  const tableName = TABLES.campaignLogs;
  const scope = companyRecordId
    ? `, FIND('${escFormula(companyRecordId)}', ARRAYJOIN({${F.companyId}}))`
    : '';

  const eqClauses = variants.map((v) => `{${F.phone}} = '${escFormula(v)}'`);
  const eqOr = eqClauses.length === 1 ? eqClauses[0] : `OR(${eqClauses.join(', ')})`;
  const eqFormula = scope ? `AND(${eqOr}${scope})` : eqOr;
  try {
    const records = await b(tableName)
      .select({ filterByFormula: eqFormula, maxRecords: 100 })
      .firstPage();
    if (records.length) {
      records.sort((a, c) => recordCreatedMs(c) - recordCreatedMs(a));
      return await campaignLogRecordToLog(records[0]);
    }
  } catch (err) {
    log.warn('getCampaignLogByPhone equality failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const ten = last10(phone);
  if (ten) {
    const findFormula = scope
      ? `AND(FIND('${escFormula(ten)}', {${F.phone}})${scope})`
      : `FIND('${escFormula(ten)}', {${F.phone}})`;
    try {
      const records = await b(tableName)
        .select({ filterByFormula: findFormula, maxRecords: 100 })
        .firstPage();
      if (records.length) {
        records.sort((a, c) => recordCreatedMs(c) - recordCreatedMs(a));
        return await campaignLogRecordToLog(records[0]);
      }
    } catch (err) {
      log.warn('getCampaignLogByPhone FIND failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback: if scoped search returned nothing, retry unscoped before giving up.
  if (companyRecordId) {
    log.warn('scoped lookup empty — retrying unscoped', { companyRecordId, phone });
    return getCampaignLogByPhone(phone);
  }
  return null;
}

/**
 * Find a Company Info row whose Blooio phone number matches the given number.
 * Useful for inbound webhooks that include the receiving Blooio number — we
 * use it to identify which company the customer texted, so we can scope the
 * Campaign Log lookup.
 *
 * @param {string} phone Receiving Blooio number from the webhook body
 */
async function findCompanyByBlooioPhoneNumber(phone) {
  const target = last10(phone);
  if (!target) return null;
  try {
    const records = await getBase()(TABLES.companyInfo).select({ maxRecords: 200 }).firstPage();
    for (const r of records) {
      const info = companyInfoFromRecord(r);
      const candidate = last10(info.blooioPhoneNumber || '');
      if (candidate && candidate === target) return info;
    }
  } catch (err) {
    log.warn('findCompanyByBlooioPhoneNumber failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/**
 * Add a phone number to the Global DNC table (idempotent).
 * Used for STOP/UNSUBSCRIBE replies to comply with TCPA and carrier rules.
 *
 * @param {string} phone E.164 phone, e.g. "+14258942169"
 * @param {string} [companyId] Optional Company ID text (e.g. "BUS-1") for traceability
 * @param {string} [reason] Optional reason ("STOP", "manual", etc.)
 */
async function addToDNC(phone, companyId, reason = 'STOP') {
  if (!phone) return;
  if (await checkDNC(phone)) return;
  const fields = { [FIELDS.globalDnc.phone]: phone };
  // Only add optional metadata fields if they exist on the user's table; tolerate UNKNOWN_FIELD_NAME.
  if (companyId) fields['Company ID'] = companyId;
  if (reason) fields.Reason = reason;
  fields['Added At'] = new Date().toISOString();

  const tryCreate = async (payload) => {
    await getBase()(TABLES.globalDnc).create([{ fields: payload }]);
  };
  let payload = { ...fields };
  for (;;) {
    try {
      await tryCreate(payload);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/Unknown field name:\s*"([^"]+)"/i);
      if (!m) {
        log.warn('addToDNC failed', { err: msg, phone });
        return;
      }
      const bad = m[1];
      if (!(bad in payload)) {
        log.warn('addToDNC failed (unknown field)', { err: msg, phone });
        return;
      }
      delete payload[bad];
      if (!Object.keys(payload).length) return;
    }
  }
}

/* ───────────────────────── message history (optional) ───────────────────────── */

async function createMessageHistoryEntry(entry) {
  if (!TABLES.messageHistory) return;
  const fields = {
    'Company ID': entry.companyId,
    Phone: entry.phone,
    Direction: entry.direction,
    Body: String(entry.body || '').slice(0, 10000),
  };
  if (entry.eventType) fields.Event = entry.eventType;
  try {
    await getBase()(TABLES.messageHistory).create([{ fields }]);
  } catch (err) {
    log.warn('message history create failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/* ───────────────────────── attachment upload (rarely used) ───────────────────────── */

function encodeBytesBase64ForAirtable(buf) {
  const b64 = Buffer.from(buf).toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return `${lines.join('\n')}\n`;
}

/**
 * Attach the CSV bytes to the Uploads row. No-op when AIRTABLE_SKIP_UPLOAD_ATTACHMENT=1
 * (recommended to avoid the content.airtable.com permissions/setup surface).
 */
async function attachCsvToUploadRecord(recordId, filename, fileBuffer) {
  if (OPTIONS.uploadSkipAttachment) return null;

  const key = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const fieldName = FIELDS.upload.attachmentsField;
  const safeName = String(filename || 'upload.csv').split(/[/\\]/).pop() || 'upload.csv';
  const contentType = safeName.toLowerCase().endsWith('.csv')
    ? 'text/csv'
    : 'application/octet-stream';

  const url = `https://content.airtable.com/v0/${baseId}/${encodeURIComponent(
    recordId
  )}/${encodeURIComponent(fieldName)}/uploadAttachment`;
  const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);

  const res = await axios.post(
    url,
    { contentType, filename: safeName, file: encodeBytesBase64ForAirtable(buf) },
    {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );
  if (res.status < 400) return res.data;
  const msg =
    typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data || res.statusText);
  throw new Error(`Airtable attachment upload (${res.status}): ${msg}`);
}

/* ───────────────────────── public API ───────────────────────── */

module.exports = {
  // company
  getCompanyInfo,
  // uploads
  createUploadRecord,
  updateUploadStatus,
  attachCsvToUploadRecord,
  // customers
  createCustomerRecord,
  getAwaitingCustomers,
  updateCustomerStatus,
  getLatestCustomerForCompanyPhone,
  customerRewardDisplayText,
  // dnc
  checkDNC,
  addToDNC,
  // company lookups
  findCompanyByBlooioPhoneNumber,
  // logs
  createCampaignLog,
  createCampaignLogBestEffort: createCampaignLog,
  updateCampaignLog,
  getCampaignLogByPhone,
  // misc
  createMessageHistoryEntry,
};
