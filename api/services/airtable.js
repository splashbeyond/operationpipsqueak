/**
 * Airtable data layer — table + field names match the Piper / Make.com base.
 * If your base uses different spellings, adjust the constants below.
 */

require('../env');

const axios = require('axios');
const Airtable = require('airtable');

const TABLES = {
  companyInfo: 'Company Info',
  uploads: 'Uploads',
  customerData: 'Customer Data',
  campaignLogs: 'Campaign Logs',
  globalDnc: 'Global DNC',
};

/** Field names on the Customer Data table (override via .env). */
function customerDataFields() {
  return {
    name: process.env.AIRTABLE_CUSTOMER_NAME_FIELD || 'Name',
    phone: process.env.AIRTABLE_CUSTOMER_PHONE_FIELD || 'Phone',
    campaign: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_FIELD || 'Campaign Type',
    status: process.env.AIRTABLE_CUSTOMER_STATUS_FIELD || 'Status',
    companyId: process.env.AIRTABLE_CUSTOMER_COMPANY_ID_FIELD || 'Company ID',
    batchId: process.env.AIRTABLE_CUSTOMER_BATCH_ID_FIELD || 'Batch ID',
    reward: process.env.AIRTABLE_CUSTOMER_REWARD_FIELD || 'Reward',
  };
}

/** When Customer Data's company field links to Company Info, API values must be `[rec…]` not text. */
function customerCompanyIdIsLink() {
  return process.env.AIRTABLE_CUSTOMER_COMPANY_ID_IS_LINK === '1';
}

/**
 * Customer Data → Status single-select labels. Each value must exist as an option in Airtable
 * (the API cannot add options unless the field allows it and the token has permission).
 */
function customerStatusValues() {
  return {
    awaiting: process.env.AIRTABLE_CUSTOMER_STATUS_AWAITING || 'Awaiting',
    processing: process.env.AIRTABLE_CUSTOMER_STATUS_PROCESSING || 'Processing',
    sent: process.env.AIRTABLE_CUSTOMER_STATUS_SENT || 'Sent',
    failed: process.env.AIRTABLE_CUSTOMER_STATUS_FAILED || 'Failed',
  };
}

/**
 * Map internal / CSV values (e.g. "review", "no_show") to Airtable single-select labels
 * (e.g. "Review", "No-Show"). Pass through unknown non-empty strings as-is.
 * @param {unknown} raw
 * @returns {string}
 */
function mapCampaignTypeToAirtableSelect(raw) {
  let s = String(raw ?? '').trim();
  if (!s) s = 'review';
  const key = s.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  const table = {
    review: 'Review',
    no_show: 'No-Show',
    noshow: 'No-Show',
    cancellation: 'Cancellation',
    cancel: 'Cancellation',
    reactivation: 'Reactivation',
    referral: 'Referral',
    upsell: 'Upsell',
    membership: 'Upsell',
    membership_upsell: 'Upsell',
  };
  if (table[key]) return table[key];
  if (/^[a-z0-9_]+$/.test(s)) {
    return s
      .split(/_+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('-');
  }
  return s;
}

/**
 * Customer Data "Campaign Type" may use different single-select labels than Campaign Logs.
 * Optional .env: AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REVIEW=…, _NO_SHOW, _CANCELLATION, etc.
 * @param {unknown} raw
 * @returns {string}
 */
function mapCustomerDataCampaignTypeSelect(raw) {
  const key =
    String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_') || 'review';
  const envByKey = {
    review: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REVIEW,
    no_show: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_NO_SHOW,
    noshow: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_NO_SHOW,
    cancellation: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_CANCELLATION,
    cancel: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_CANCELLATION,
    reactivation: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REACTIVATION,
    referral: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REFERRAL,
    upsell: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_UPSELL,
    membership: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_UPSELL,
    membership_upsell: process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_UPSELL,
  };
  const fromEnv = envByKey[key];
  if (fromEnv != null && String(fromEnv).trim() !== '') return String(fromEnv).trim();
  return mapCampaignTypeToAirtableSelect(raw);
}

/** Field names on Campaign Logs (override via .env). */
function campaignLogFields() {
  return {
    companyId: process.env.AIRTABLE_CAMPAIGN_LOG_COMPANY_ID_FIELD || 'Company ID',
    phone:
      process.env.AIRTABLE_CAMPAIGN_LOG_PHONE_FIELD ||
      process.env.AIRTABLE_CUSTOMER_PHONE_FIELD ||
      'Phone',
    campaign: process.env.AIRTABLE_CAMPAIGN_LOG_CAMPAIGN_FIELD || 'Campaign Type',
    status: process.env.AIRTABLE_CAMPAIGN_LOG_STATUS_FIELD || 'Status',
    batchId: process.env.AIRTABLE_CAMPAIGN_LOG_BATCH_ID_FIELD || 'Batch ID',
    snapshotLinks:
      process.env.AIRTABLE_CAMPAIGN_LOG_SNAPSHOT_LINKS_FIELD || 'Snapshot: Links',
    latestReply: process.env.AIRTABLE_CAMPAIGN_LOG_LATEST_REPLY_FIELD || 'Latest Reply',
    handshakeSentAt:
      process.env.AIRTABLE_CAMPAIGN_LOG_HANDSHAKE_SENT_AT_FIELD || 'Handshake Sent At',
    repliedAt: process.env.AIRTABLE_CAMPAIGN_LOG_REPLIED_AT_FIELD || 'Replied At',
    targetPayload:
      process.env.AIRTABLE_CAMPAIGN_LOG_TARGET_PAYLOAD_FIELD || 'Target Payload',
  };
}

/** When Campaign Logs → Company ID links to Company Info, API values must be `[rec…]` not text. */
function campaignLogCompanyIdIsLink() {
  return process.env.AIRTABLE_CAMPAIGN_LOG_COMPANY_ID_IS_LINK === '1';
}

/** Universal CSV doc: one text field "Company ID & Phone" instead of separate company + phone columns. */
function campaignLogUsesCombinedCompanyPhone() {
  return process.env.AIRTABLE_CAMPAIGN_LOG_USE_COMBINED_COMPANY_PHONE === '1';
}

function campaignLogCombinedFieldName() {
  return process.env.AIRTABLE_CAMPAIGN_LOG_COMPANY_PHONE_FIELD || 'Company ID & Phone';
}

function campaignLogsTableName() {
  return process.env.AIRTABLE_CAMPAIGN_LOG_TABLE || TABLES.campaignLogs;
}

/** @type {import('airtable').Base} */
let base;

function getBase() {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    throw new Error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID');
  }
  if (!base) {
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    base = Airtable.base(process.env.AIRTABLE_BASE_ID);
  }
  return base;
}

/**
 * @param {string} value
 */
function escapeFormulaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Match Python base64.encodebytes (76-char lines + trailing newline), same as pyairtable’s upload body.
 * @param {Buffer} buf
 */
function encodeBytesBase64ForAirtable(buf) {
  const b64 = Buffer.from(buf).toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * E.164 and digit variants so webhooks still match Campaign Logs if formatting differs.
 * @param {string} phone
 */
function phoneVariantsForMatch(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  /** @type {string[]} */
  const variants = [];
  if (raw) variants.push(raw);
  if (digits.length === 10) variants.push(`+1${digits}`);
  if (digits.length === 11 && digits.startsWith('1')) variants.push(`+${digits}`);
  return [...new Set(variants)];
}

/**
 * @param {import('airtable').Record<any>} record
 */
function recordCreatedMs(record) {
  const raw = record._rawJson;
  const t = raw && raw.createdTime;
  return t ? Date.parse(t) : 0;
}

/**
 * @param {import('airtable').Record<any>} record
 */
function companyInfoFromRecord(record) {
  const blooioCredField =
    process.env.AIRTABLE_COMPANY_BLOOIO_CREDENTIALS_FIELD || 'Blooio API Key & Phone';
  const blooioCombined = record.get(blooioCredField);
  const legacyKey = record.get('Blooio API Key');
  let blooioApiKey = legacyKey;
  let blooioPhoneNumber = record.get('Blooio Phone Number') ?? record.get('Blooio Phone');
  if (!blooioApiKey && blooioCombined != null && String(blooioCombined).trim() !== '') {
    const s = String(blooioCombined).trim();
    if (s.includes('\n')) {
      blooioApiKey = s.split('\n')[0].trim();
      const rest = s.split('\n').slice(1).join('\n').trim();
      if (rest && !blooioPhoneNumber) blooioPhoneNumber = rest;
    } else if (s.includes('|')) {
      const parts = s.split('|').map((x) => x.trim());
      blooioApiKey = parts[0] || s;
      if (parts.length > 1 && !blooioPhoneNumber) {
        blooioPhoneNumber = parts.slice(1).join('|').trim();
      }
    } else {
      blooioApiKey = s;
    }
  }

  const handshakeField =
    process.env.AIRTABLE_COMPANY_HANDSHAKE_MATRIX_FIELD || 'Handshake Matrix';
  const payloadField = process.env.AIRTABLE_COMPANY_PAYLOAD_MATRIX_FIELD || 'Payload Matrix';
  const payloadRewardField =
    process.env.AIRTABLE_COMPANY_PAYLOAD_MATRIX_REWARD_FIELD || 'Payload Matrix (Reward)';
  const payloadNoRewardField =
    process.env.AIRTABLE_COMPANY_PAYLOAD_MATRIX_NO_REWARD_FIELD || 'Payload Matrix (No Reward)';
  const inboundReminderField =
    process.env.AIRTABLE_COMPANY_INBOUND_REMINDER_FIELD || 'Inbound Reminder';
  const handshakeMatrix = record.get(handshakeField);
  const payloadMatrix = record.get(payloadField);
  const payloadMatrixReward = record.get(payloadRewardField);
  const payloadMatrixNoReward = record.get(payloadNoRewardField);
  const inboundReminderTemplate = record.get(inboundReminderField);
  const reviewLegacy =
    record.get(process.env.AIRTABLE_COMPANY_REVIEW_TEMPLATE_FIELD || 'Review Template');

  const hReviewReward = record.get('Handshake: Review (Reward)');
  const hReviewNoReward = record.get('Handshake: Review (No Reward)');
  const hNoShowReward = record.get('Handshake: No-Show (Reward)');
  const hNoShowNoReward = record.get('Handshake: No-Show (No Reward)');
  const hCancellationReward = record.get('Handshake: Cancellation (Reward)');
  const hCancellationNoReward = record.get('Handshake: Cancellation (No Reward)');
  const hReactivationReward = record.get('Handshake: Reactivation (Reward)');
  const hReactivationNoReward = record.get('Handshake: Reactivation (No Reward)');
  const hReferralReward = record.get('Handshake: Referral (Reward)');
  const hReferralNoReward = record.get('Handshake: Referral (No Reward)');
  const hUpsellReward = record.get('Handshake: Upsell (Reward)');
  const hUpsellNoReward = record.get('Handshake: Upsell (No Reward)');

  return {
    recordId: record.id,
    companyId: record.get('Company ID'),
    businessName: record.get('Business Name'),
    blooioApiKey,
    blooioPhoneNumber,
    handshakeMatrix: handshakeMatrix ?? '',
    payloadMatrix: payloadMatrix ?? '',
    payloadMatrixReward: payloadMatrixReward ?? '',
    payloadMatrixNoReward: payloadMatrixNoReward ?? '',
    inboundReminderTemplate: inboundReminderTemplate ?? '',

    // Legacy + new Universal CSV handshake fields
    reviewTemplateReward: hReviewReward ?? '',
    reviewTemplateNoReward: hReviewNoReward ?? '',
    noShowTemplateReward: hNoShowReward ?? '',
    noShowTemplateNoReward: hNoShowNoReward ?? '',
    cancellationTemplateReward: hCancellationReward ?? '',
    cancellationTemplateNoReward: hCancellationNoReward ?? '',
    reactivationTemplateReward: hReactivationReward ?? '',
    reactivationTemplateNoReward: hReactivationNoReward ?? '',
    referralTemplateReward: hReferralReward ?? '',
    referralTemplateNoReward: hReferralNoReward ?? '',
    upsellTemplateReward: hUpsellReward ?? '',
    upsellTemplateNoReward: hUpsellNoReward ?? '',

    reviewTemplate: reviewLegacy || hReviewReward || hReviewNoReward || handshakeMatrix || '',
    noShowTemplate:
      record.get('No Show Template') ?? hNoShowReward ?? hNoShowNoReward ?? handshakeMatrix ?? '',
    cancellationTemplate:
      record.get('Cancellation Template') ??
      hCancellationReward ??
      hCancellationNoReward ??
      handshakeMatrix ??
      '',
    reactivationTemplate:
      record.get('Reactivation Template') ??
      hReactivationReward ??
      hReactivationNoReward ??
      handshakeMatrix ??
      '',
    upsellTemplate:
      record.get('Membership/Upsell Template') ??
      record.get('Membership Upsell Template') ??
      hUpsellReward ??
      hUpsellNoReward ??
      handshakeMatrix ??
      '',
    referralReviewTemplate:
      record.get('Review Template (for referral)') ??
      record.get('Review Template (Referral)') ??
      hReferralReward ??
      hReferralNoReward ??
      record.get('Review Template') ??
      handshakeMatrix,

    // Legacy + new Universal CSV payload field aliases
    reviewPayloadReward: record.get('Review Payload (Reward)') ?? record.get('Payload: Review (Reward)') ?? '',
    reviewPayloadNoReward: record.get('Review Payload (No Reward)') ?? record.get('Payload: Review (No Reward)') ?? '',
    noShowPayloadReward: record.get('No-Show Payload (Reward)') ?? record.get('Payload: Booking (Reward)') ?? '',
    noShowPayloadNoReward: record.get('No-Show Payload (No Reward)') ?? record.get('Payload: Booking (No Reward)') ?? '',
    cancellationPayloadReward: record.get('Cancellation Payload (Reward)') ?? '',
    cancellationPayloadNoReward: record.get('Cancellation Payload (No Reward)') ?? '',
    reactivationPayloadReward: record.get('Reactivation Payload (Reward)') ?? '',
    reactivationPayloadNoReward: record.get('Reactivation Payload (No Reward)') ?? '',
    referralPayloadReward: record.get('Referral Payload (Reward)') ?? record.get('Payload: Referral (Reward)') ?? '',
    referralPayloadNoReward: record.get('Referral Payload (No Reward)') ?? record.get('Payload: Referral (No Reward)') ?? '',
    upsellPayloadReward: record.get('Upsell Payload (Reward)') ?? record.get('Payload: Upsell (Reward)') ?? '',
    upsellPayloadNoReward: record.get('Upsell Payload (No Reward)') ?? record.get('Payload: Upsell (No Reward)') ?? '',

    bookingLink: record.get('Booking Link'),
    reviewLink: record.get('Review Link'),
    membershipLink: record.get('Membership Link') ?? record.get('Upsell Link'),
    ownerMobile: record.get('Owner Mobile'),
  };
}

/**
 * @param {string} companyId Company Info "Company ID" text, or a Company Info record id (rec…)
 */
async function getCompanyInfo(companyId) {
  const b = getBase();
  const id = String(companyId || '').trim();
  if (id.startsWith('rec')) {
    try {
      const record = await b(TABLES.companyInfo).find(id);
      return companyInfoFromRecord(record);
    } catch {
      // Not a Company Info row id; treat as literal Company ID value below
    }
  }
  const formula = `{Company ID} = '${escapeFormulaString(id)}'`;
  const records = await b(TABLES.companyInfo)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .firstPage();
  if (!records.length) return null;
  return companyInfoFromRecord(records[0]);
}

/**
 * @param {string} companyId
 * @param {string} [batchName]
 * @param {{ reward?: string }} [options] Batch-level reward note (optional Uploads field via AIRTABLE_UPLOAD_REWARD_FIELD)
 */
async function createUploadRecord(companyId, batchName, options = {}) {
  const company = await getCompanyInfo(companyId);
  if (!company) {
    throw new Error(
      `Company not found: ${companyId}. Add or fix a row in "Company Info" with field Company ID = ${companyId}.`
    );
  }

  const F = {
    status: process.env.AIRTABLE_UPLOAD_STATUS_FIELD || 'Status',
    batchId: process.env.AIRTABLE_UPLOAD_BATCH_ID_FIELD || 'Batch ID',
    companyLink: process.env.AIRTABLE_UPLOAD_COMPANY_LINK_FIELD || 'Company',
    companyId: process.env.AIRTABLE_UPLOAD_COMPANY_ID_FIELD || 'Company ID',
  };

  const initialStatus =
    process.env.AIRTABLE_UPLOAD_INITIAL_STATUS ||
    process.env.AIRTABLE_UPLOAD_STATUS_PENDING ||
    'Pending';

  const common = {
    [F.status]: initialStatus,
  };
  const omitBatch = process.env.AIRTABLE_UPLOAD_OMIT_BATCH_ID === '1';
  if (
    !omitBatch &&
    batchName !== undefined &&
    batchName !== null &&
    String(batchName).trim() !== '' &&
    F.batchId
  ) {
    common[F.batchId] = String(batchName).trim();
  }
  const uploadRewardField = process.env.AIRTABLE_UPLOAD_REWARD_FIELD;
  const batchReward =
    options.reward !== undefined && options.reward !== null
      ? String(options.reward).trim()
      : '';
  if (uploadRewardField && batchReward) {
    common[uploadRewardField] = batchReward;
  }

  const b = getBase();
  const skipLink = process.env.AIRTABLE_UPLOAD_SKIP_COMPANY_LINK === '1';

  /**
   * Airtable INVALID_VALUE_FOR_COLUMN often means Batch ID is a link/number, Reward field wrong type, etc.
   * Retry without optional fields before failing.
   * @param {Record<string, unknown>} fields
   */
  const createWithFallbacks = async (fields) => {
    /** @type {Record<string, unknown>[]} */
    const attempts = [];
    const addAttempt = (o) => {
      const s = JSON.stringify(o);
      if (!attempts.some((x) => JSON.stringify(x) === s)) attempts.push({ ...o });
    };
    addAttempt(fields);
    const noBatch = { ...fields };
    if (F.batchId && noBatch[F.batchId] !== undefined) {
      delete noBatch[F.batchId];
      addAttempt(noBatch);
    }
    const noBatchNoReward = { ...noBatch };
    if (uploadRewardField && noBatchNoReward[uploadRewardField] !== undefined) {
      delete noBatchNoReward[uploadRewardField];
      addAttempt(noBatchNoReward);
    }

    let lastErr;
    for (let i = 0; i < attempts.length; i++) {
      try {
        const created = await b(TABLES.uploads).create([{ fields: attempts[i] }]);
        if (i > 0) {
          console.warn(
            '[airtable] Uploads create succeeded after omitting Batch ID and/or Upload reward (check field types or set AIRTABLE_UPLOAD_OMIT_BATCH_ID=1).'
          );
        }
        return created[0].id;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/INVALID_VALUE_FOR_COLUMN/i.test(msg)) throw err;
      }
    }
    const hint =
      ' Uploads row: ensure Status option exists (set AIRTABLE_UPLOAD_INITIAL_STATUS), Batch ID accepts text (or AIRTABLE_UPLOAD_OMIT_BATCH_ID=1), and AIRTABLE_UPLOAD_REWARD_FIELD is long text if used.';
    const m = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`${m}.${hint}`);
  };

  if (!skipLink && F.companyLink) {
    try {
      return await createWithFallbacks({ ...common, [F.companyLink]: [company.recordId] });
    } catch (err) {
      const hint = err instanceof Error ? err.message : String(err);
      console.warn('[airtable] Uploads create with link field failed, retrying text Company ID:', hint);
    }
  }

  const fieldsText = { ...common };
  if (process.env.AIRTABLE_UPLOAD_OMIT_COMPANY_ID_TEXT !== '1' && F.companyId) {
    fieldsText[F.companyId] = companyId;
  }
  return createWithFallbacks(fieldsText);
}

/**
 * @param {string} recordId
 * @param {string} status
 */
async function updateUploadStatus(recordId, status) {
  const b = getBase();
  const statusField = process.env.AIRTABLE_UPLOAD_STATUS_FIELD || 'Status';
  await b(TABLES.uploads).update([{ id: recordId, fields: { [statusField]: status } }]);
}

/**
 * @param {{ name: string, phone: string, campaignType: string, companyId: string, batchId?: string, reward?: string }} data
 */
async function createCustomerRecord(data) {
  const CF = customerDataFields();
  const company = await getCompanyInfo(data.companyId);
  if (!company) {
    throw new Error(
      `Company not found for Customer Data: ${data.companyId}. Add a row in "Company Info" with Company ID matching the upload, or use a Company Info record id.`
    );
  }

  const S = customerStatusValues();
  const fields = {
    [CF.name]: data.name,
    [CF.phone]: data.phone,
    [CF.status]: S.awaiting,
    [CF.companyId]: customerCompanyIdIsLink() ? [company.recordId] : data.companyId,
  };
  if (process.env.AIRTABLE_CUSTOMER_OMIT_CAMPAIGN_ON_CREATE !== '1' && CF.campaign) {
    fields[CF.campaign] = mapCustomerDataCampaignTypeSelect(data.campaignType);
  }
  if (
    process.env.AIRTABLE_CUSTOMER_OMIT_BATCH_ID !== '1' &&
    data.batchId !== undefined &&
    data.batchId !== null &&
    data.batchId !== '' &&
    CF.batchId
  ) {
    fields[CF.batchId] = data.batchId;
  }
  if (
    process.env.AIRTABLE_CUSTOMER_OMIT_REWARD !== '1' &&
    CF.reward &&
    data.reward !== undefined &&
    data.reward !== null &&
    String(data.reward).trim() !== ''
  ) {
    fields[CF.reward] = String(data.reward).trim();
  }
  const b = getBase();
  try {
    const created = await b(TABLES.customerData).create([{ fields }]);
    return created[0].id;
  } catch (err) {
    const sent = Object.keys(fields)
      .map((k) => `${k}=${JSON.stringify(fields[k]).slice(0, 40)}`)
      .join(', ');
    let hint =
      ' In .env set AIRTABLE_CUSTOMER_NAME_FIELD, _PHONE_FIELD, _CAMPAIGN_FIELD, _STATUS_FIELD, _COMPANY_ID_FIELD, _BATCH_ID_FIELD to match Customer Data column names exactly. If there is no batch column, set AIRTABLE_CUSTOMER_OMIT_BATCH_ID=1. If the company column is a link to Company Info (not plain text), set AIRTABLE_CUSTOMER_COMPANY_ID_IS_LINK=1.';
    const msg = err instanceof Error ? err.message : String(err);
    if (/INVALID_MULTIPLE_CHOICE|create new select option|select option/i.test(msg)) {
      hint +=
        ' For Customer Data → Campaign Type: add the exact option in Airtable (e.g. Review), or map it with AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REVIEW=YourExactLabel. If the column should not be set on upload, set AIRTABLE_CUSTOMER_OMIT_CAMPAIGN_ON_CREATE=1.';
    }
    throw new Error(`${msg} — sent: ${sent}.${hint}`);
  }
}

/**
 * @param {number} [limit]
 */
async function getAwaitingCustomers(limit = 10) {
  const CF = customerDataFields();
  const S = customerStatusValues();
  const b = getBase();
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const records = await b(TABLES.customerData)
    .select({
      filterByFormula: `{${CF.status}} = '${escapeFormulaString(S.awaiting)}'`,
      maxRecords: safeLimit,
    })
    .firstPage();

  /** @type {{ id: string, name: unknown, phone: unknown, campaignType: unknown, companyId: string, batchId: unknown, status: unknown, reward: unknown }[]} */
  const out = [];
  for (const r of records) {
    let raw = r.get(CF.companyId);
    if (Array.isArray(raw)) raw = raw[0] ?? '';
    let companyId = String(raw || '');
    if (companyId.startsWith('rec')) {
      const info = await getCompanyInfo(companyId);
      if (info && info.companyId != null && String(info.companyId).trim() !== '') {
        companyId = String(info.companyId);
      }
    }
    out.push({
      id: r.id,
      name: r.get(CF.name),
      phone: r.get(CF.phone),
      campaignType: r.get(CF.campaign),
      companyId,
      batchId: r.get(CF.batchId),
      status: r.get(CF.status),
      reward: r.get(CF.reward),
    });
  }
  return out;
}

/**
 * @param {string} recordId
 * @param {string} status
 */
async function updateCustomerStatus(recordId, status) {
  const CF = customerDataFields();
  const b = getBase();
  await b(TABLES.customerData).update([{ id: recordId, fields: { [CF.status]: status } }]);
}

/**
 * Latest Customer Data row for this company + phone (for reward flag + [Name] on inbound payload).
 * @param {string} companyIdText Company Info "Company ID" text (e.g. BUS-1), not necessarily rec…
 * @param {string} phone
 * @returns {Promise<{ id: string, name: unknown, reward: unknown } | null>}
 */
async function getLatestCustomerForCompanyPhone(companyIdText, phone) {
  const CF = customerDataFields();
  const variants = phoneVariantsForMatch(phone);
  if (!variants.length) return null;

  const company = await getCompanyInfo(companyIdText);
  if (!company) return null;

  const phoneClauses = variants.map(
    (v) => `{${CF.phone}} = '${escapeFormulaString(v)}'`
  );
  const phoneFormula = phoneClauses.length === 1 ? phoneClauses[0] : `OR(${phoneClauses.join(', ')})`;
  const b = getBase();
  const records = await b(TABLES.customerData)
    .select({ filterByFormula: phoneFormula, maxRecords: 100 })
    .firstPage();
  if (!records.length) return null;

  const companyIdWanted = String(company.companyId || companyIdText).trim();
  /** @type {import('airtable').Record<any>[]} */
  const matching = [];
  for (const r of records) {
    let raw = r.get(CF.companyId);
    if (Array.isArray(raw)) raw = raw[0] ?? '';
    let cid = String(raw || '').trim();
    if (cid.startsWith('rec')) {
      const info = await getCompanyInfo(cid);
      cid = info && info.companyId != null ? String(info.companyId).trim() : cid;
    }
    if (cid === companyIdWanted) matching.push(r);
  }
  if (!matching.length) return null;

  matching.sort((a, c) => recordCreatedMs(c) - recordCreatedMs(a));
  const r = matching[0];
  return {
    id: r.id,
    name: r.get(CF.name),
    reward: r.get(CF.reward),
  };
}

/**
 * @param {unknown} raw Customer Data → Reward (text, checkbox, or select)
 */
function customerRewardDisplayText(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'boolean') return raw ? 'Yes' : '';
  return String(raw).trim();
}

/**
 * @param {string} phone E.164 or raw; matched against Global DNC
 */
async function checkDNC(phone) {
  const variants = phoneVariantsForMatch(phone);
  if (!variants.length) return false;

  const b = getBase();
  const clauses = variants.map((v) => `{Phone Number} = '${escapeFormulaString(v)}'`);
  const formula = clauses.length === 1 ? clauses[0] : `OR(${clauses.join(', ')})`;
  const records = await b(TABLES.globalDnc)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .firstPage();
  return records.length > 0;
}

/**
 * @param {{ companyId: string, phone: string, campaignType: string, batchId?: string, status: string, snapshotLinks?: string, messageBody?: string, handshakeSentAt?: string }} data
 */
async function createCampaignLog(data) {
  const F = campaignLogFields();
  const useCombined = campaignLogUsesCombinedCompanyPhone();
  const combinedName = campaignLogCombinedFieldName();
  const campaignLabel = mapCampaignTypeToAirtableSelect(data.campaignType);

  /** @type {Record<string, unknown>} */
  const fields = {};

  if (useCombined) {
    fields[combinedName] = `${data.companyId} | ${data.phone}`;
  } else {
    let companyValue = data.companyId;
    if (campaignLogCompanyIdIsLink()) {
      const info = await getCompanyInfo(data.companyId);
      if (!info) {
        throw new Error(
          `Company not found for Campaign Logs: ${data.companyId}. Cannot write linked Company ID.`
        );
      }
      companyValue = [info.recordId];
    }
    fields[F.companyId] = companyValue;
    fields[F.phone] = data.phone;
  }

  fields[F.status] = data.status;
  if (process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN !== '1' && F.campaign) {
    fields[F.campaign] = campaignLabel;
  }
  if (
    process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_BATCH_ID !== '1' &&
    data.batchId !== undefined &&
    data.batchId !== null &&
    data.batchId !== '' &&
    F.batchId
  ) {
    fields[F.batchId] = data.batchId;
  }
  if (
    data.snapshotLinks !== undefined &&
    data.snapshotLinks !== null &&
    data.snapshotLinks !== '' &&
    F.snapshotLinks
  ) {
    fields[F.snapshotLinks] = data.snapshotLinks;
  }
  if (
    process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_TARGET_PAYLOAD !== '1' &&
    data.messageBody !== undefined &&
    data.messageBody !== null &&
    String(data.messageBody).trim() !== '' &&
    F.targetPayload
  ) {
    fields[F.targetPayload] = String(data.messageBody).trim().slice(0, 100000);
  }
  if (
    data.handshakeSentAt !== undefined &&
    data.handshakeSentAt !== null &&
    String(data.handshakeSentAt).trim() !== '' &&
    F.handshakeSentAt
  ) {
    fields[F.handshakeSentAt] = String(data.handshakeSentAt).trim();
  }
  const b = getBase();
  const tableName = campaignLogsTableName();
  const tryCreate = async (payload) => {
    const created = await b(tableName).create([{ fields: payload }]);
    return created[0].id;
  };
  try {
    return await tryCreate(fields);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const attachmentOrCell =
      /attachment|attachments|cannot accept|INVALID_VALUE_FOR_COLUMN|cell value/i.test(msg);
    if (attachmentOrCell && F.snapshotLinks && fields[F.snapshotLinks] !== undefined) {
      console.warn('[airtable] createCampaignLog: retrying without Snapshot field:', msg);
      const without = { ...fields };
      delete without[F.snapshotLinks];
      try {
        return await tryCreate(without);
      } catch (err2) {
        const m2 = err2 instanceof Error ? err2.message : String(err2);
        const logFields = { ...without };
        if (!useCombined && Array.isArray(logFields[F.companyId])) {
          logFields[F.companyId] = ['(linked Company Info record)'];
        }
        console.error(`[airtable] createCampaignLog table=${tableName} fields=`, JSON.stringify(logFields));
        if (/UNKNOWN_FIELD_NAME/i.test(m2)) {
          throw new Error(
            `${m2} Open your base in Airtable → API docs → Campaign Logs and set AIRTABLE_CAMPAIGN_LOG_*_FIELD env vars to match exact column names (e.g. phone column might be "Number" not "Phone"). Or AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN=1 if there is no campaign column.`
          );
        }
        if (/INVALID_MULTIPLE_CHOICE|select option|cannot accept the provided value/i.test(m2)) {
          throw new Error(
            `${m2} A single-select on Campaign Logs rejected a value (often Campaign Type or Status). Match spelling to Airtable options, or set AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN=1, and set AIRTABLE_OUTBOUND_CAMPAIGN_LOG_STATUS to an exact option (e.g. Handshake Sent).`
          );
        }
        throw err2;
      }
    }
    const logFields = { ...fields };
    if (!useCombined && Array.isArray(logFields[F.companyId])) {
      logFields[F.companyId] = ['(linked Company Info record)'];
    }
    console.error(`[airtable] createCampaignLog table=${tableName} fields=`, JSON.stringify(logFields));
    if (
      /INVALID_VALUE|not an array of record IDs/i.test(msg) &&
      !campaignLogCompanyIdIsLink()
    ) {
      throw new Error(
        `${msg} If "Company ID" on Campaign Logs is a link to Company Info, set AIRTABLE_CAMPAIGN_LOG_COMPANY_ID_IS_LINK=1 in .env.`
      );
    }
    if (/UNKNOWN_FIELD_NAME/i.test(msg)) {
      throw new Error(
        `${msg} Open your base in Airtable → API docs → Campaign Logs and set AIRTABLE_CAMPAIGN_LOG_*_FIELD env vars to match exact column names (e.g. phone column might be "Number" not "Phone"). Or AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN=1 if there is no campaign column.`
      );
    }
    if (/INVALID_MULTIPLE_CHOICE|select option|cannot accept the provided value/i.test(msg)) {
      throw new Error(
        `${msg} A single-select on Campaign Logs rejected a value (often Campaign Type or Status). Match spelling to Airtable options, or set AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN=1, and set AIRTABLE_OUTBOUND_CAMPAIGN_LOG_STATUS to an exact option (e.g. Handshake Sent).`
      );
    }
    throw err;
  }
}

/**
 * Try full Campaign Logs row; on Airtable error, retry with only company/phone + status
 * (avoids UNKNOWN_FIELD / formula Target Payload / extra single-select issues).
 * @param {{ companyId: string, phone: string, campaignType: string, batchId?: string, status: string, snapshotLinks?: string, messageBody?: string, handshakeSentAt?: string }} data
 * @returns {Promise<string | null>} new record id, or null if both attempts failed
 */
async function createCampaignLogBestEffort(data) {
  try {
    return await createCampaignLog(data);
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    console.warn('[airtable] createCampaignLog (full) failed, retrying minimal:', msg);

    const F = campaignLogFields();
    const useCombined = campaignLogUsesCombinedCompanyPhone();
    const combinedName = campaignLogCombinedFieldName();
    const tableName = campaignLogsTableName();
    const campaignLabel = mapCampaignTypeToAirtableSelect(data.campaignType);
    let companyValue = data.companyId;
    if (campaignLogCompanyIdIsLink()) {
      const info = await getCompanyInfo(data.companyId);
      if (!info) {
        console.error('[airtable] createCampaignLog minimal: company not found', data.companyId);
        return null;
      }
      companyValue = [info.recordId];
    }

    /** @type {Record<string, unknown>} */
    const shared = { [F.status]: data.status };
    if (process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN !== '1' && F.campaign) {
      shared[F.campaign] = campaignLabel;
    }
    if (
      process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_BATCH_ID !== '1' &&
      data.batchId !== undefined &&
      data.batchId !== null &&
      data.batchId !== '' &&
      F.batchId
    ) {
      shared[F.batchId] = data.batchId;
    }
    if (
      process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_TARGET_PAYLOAD !== '1' &&
      data.messageBody !== undefined &&
      data.messageBody !== null &&
      String(data.messageBody).trim() !== '' &&
      F.targetPayload
    ) {
      shared[F.targetPayload] = String(data.messageBody).trim().slice(0, 100000);
    }
    if (
      data.handshakeSentAt !== undefined &&
      data.handshakeSentAt !== null &&
      String(data.handshakeSentAt).trim() !== '' &&
      F.handshakeSentAt
    ) {
      shared[F.handshakeSentAt] = String(data.handshakeSentAt).trim();
    }

    /** @type {Array<Record<string, unknown>>} */
    const attempts = [];
    if (useCombined) {
      const combinedCandidates = [
        combinedName,
        'Company ID & Phone',
        'Company + Phone',
        'CompanyID & Phone',
        'Queue ID & Phone',
      ];
      const seen = new Set();
      for (const name of combinedCandidates) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        attempts.push({
          [name]: `${data.companyId} | ${data.phone}`,
          ...shared,
        });
      }
      // Fallback if this base actually uses separate columns.
      attempts.push({
        [F.companyId]: companyValue,
        [F.phone]: data.phone,
        ...shared,
      });
    } else {
      attempts.push({
        [F.companyId]: companyValue,
        [F.phone]: data.phone,
        ...shared,
      });
      // Fallback if this base has one combined column.
      attempts.push({
        [combinedName]: `${data.companyId} | ${data.phone}`,
        ...shared,
      });
    }

    const b = getBase();
    for (const fields of attempts) {
      try {
        const created = await b(tableName).create([{ fields }]);
        console.log('[airtable] createCampaignLog minimal retry succeeded');
        return created[0].id;
      } catch (minimalErr) {
        const m = minimalErr instanceof Error ? minimalErr.message : String(minimalErr);
        console.error('[airtable] createCampaignLog minimal retry failed:', m);
        console.error('[airtable] minimal fields=', JSON.stringify(fields));
      }
    }
    return null;
  }
}

/**
 * @param {string} recordId
 * @param {Record<string, unknown>} data Airtable field name -> value
 */
async function updateCampaignLog(recordId, data) {
  const b = getBase();
  await b(campaignLogsTableName()).update([{ id: recordId, fields: data }]);
}

/**
 * @param {string} phone
 */
async function getCampaignLogByPhone(phone) {
  const variants = phoneVariantsForMatch(phone);
  if (!variants.length) return null;

  const F = campaignLogFields();
  const b = getBase();
  const useCombined = campaignLogUsesCombinedCompanyPhone();
  const combinedName = campaignLogCombinedFieldName();

  let formula;
  if (useCombined) {
    const clauses = variants.map(
      (v) => `FIND('${escapeFormulaString(v)}', {${combinedName}})`
    );
    formula = clauses.length === 1 ? clauses[0] : `OR(${clauses.join(', ')})`;
  } else {
    const clauses = variants.map((v) => `{${F.phone}} = '${escapeFormulaString(v)}'`);
    formula = clauses.length === 1 ? clauses[0] : `OR(${clauses.join(', ')})`;
  }

  const records = await b(campaignLogsTableName())
    .select({ filterByFormula: formula, maxRecords: 100 })
    .firstPage();
  if (!records.length) return null;

  records.sort((a, b) => recordCreatedMs(b) - recordCreatedMs(a));
  const r = records[0];

  let companyId = '';
  let phoneLog = '';
  if (useCombined) {
    const raw = r.get(combinedName);
    const str = String(raw ?? '');
    if (str.includes('|')) {
      const parts = str.split('|').map((x) => x.trim());
      companyId = parts[0] || '';
      phoneLog = parts.slice(1).join(' | ').trim() || str;
    } else {
      phoneLog = str;
    }
  } else {
    let cid = r.get(F.companyId);
    if (Array.isArray(cid)) {
      const rid = cid[0] ?? '';
      if (String(rid).startsWith('rec')) {
        const info = await getCompanyInfo(String(rid));
        companyId = info?.companyId != null ? String(info.companyId) : String(rid);
      } else {
        companyId = String(rid || '');
      }
    } else {
      companyId = cid != null && cid !== '' ? String(cid) : '';
    }
    phoneLog = String(r.get(F.phone) ?? '');
  }

  return {
    id: r.id,
    companyId,
    phone: phoneLog,
    campaignType: r.get(F.campaign),
    status: r.get(F.status),
    batchId: r.get(F.batchId),
    snapshotLinks: r.get(F.snapshotLinks),
    targetPayload: r.get(F.targetPayload),
    latestReply: r.get(F.latestReply),
  };
}

/**
 * Optional audit trail. Set AIRTABLE_MESSAGE_HISTORY_TABLE (e.g. "Message History") and matching fields in Airtable.
 * Safe no-op if env unset or create fails.
 * @param {{ companyId: string, phone: string, direction: 'Inbound' | 'Outbound', body: string, eventType?: string }} entry
 */
/**
 * Fallback when JSON+base64 upload fails (some tokens/clients behave better with multipart).
 * @param {string} url
 * @param {string} key
 * @param {Buffer} buf
 * @param {string} safeName
 * @param {string} contentType
 */
async function tryUploadAttachmentMultipart(url, key, buf, safeName, contentType) {
  try {
    const form = new FormData();
    const blob = new Blob([buf], { type: contentType });
    form.append('file', blob, safeName);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: form,
    });
    const raw = await res.text();
    /** @type {Record<string, unknown>} */
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { parseError: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Put the CSV into the Uploads row’s attachment field (Airtable pulls file from base64 payload).
 * @see https://airtable.com/developers/web/api/upload-attachment
 * @param {string} recordId
 * @param {string} filename
 * @param {Buffer} fileBuffer
 */
async function attachCsvToUploadRecord(recordId, filename, fileBuffer) {
  if (process.env.AIRTABLE_SKIP_UPLOAD_ATTACHMENT === '1') {
    return null;
  }

  const key = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!key || !baseId) {
    throw new Error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID');
  }

  const fieldName = process.env.AIRTABLE_UPLOAD_ATTACHMENTS_FIELD || 'Attachments';
  const safeName = String(filename || 'upload.csv').split(/[/\\]/).pop() || 'upload.csv';
  const contentType = safeName.toLowerCase().endsWith('.csv')
    ? 'text/csv'
    : 'application/octet-stream';

  const url = `https://content.airtable.com/v0/${baseId}/${encodeURIComponent(recordId)}/${encodeURIComponent(fieldName)}/uploadAttachment`;
  const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
  const filePayload = encodeBytesBase64ForAirtable(buf);

  const res = await axios.post(
    url,
    {
      contentType,
      filename: safeName,
      file: filePayload,
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  if (res.status < 400) {
    return res.data;
  }

  const mp = await tryUploadAttachmentMultipart(url, key, buf, safeName, contentType);
  if (mp.ok && mp.status < 400) {
    return mp.data;
  }

  const body = res.data && typeof res.data === 'object' ? res.data : {};
  const errType = body.error?.type;
  const msg = body.error?.message || body.message || JSON.stringify(res.data || {});
  let hint = '';
  if (errType === 'UNKNOWN_FIELD_NAME') {
    hint = ` The field "${fieldName}" is not a multiple-attachments field on the Uploads row’s table, or the name is wrong. In Airtable: Uploads → field → customize; copy the exact name or use fld… as AIRTABLE_UPLOAD_ATTACHMENTS_FIELD (from API / get base schema). Or set AIRTABLE_SKIP_UPLOAD_ATTACHMENT=1 to skip storing the file.`;
  } else if (res.status === 403 || errType === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND') {
    hint =
      ' Personal access token: at https://airtable.com/create/tokens ensure data.records:read and data.records:write; add this base under Access and set permission to Write (Read-only causes this error). schema.bases:read is optional for Piper (only needed if you use Airtable meta/schema APIs). In the base, check Share / collaborator permissions and any field- or table-level editing restrictions on the attachment column. Confirm AIRTABLE_UPLOAD_ATTACHMENTS_FIELD points at a multiple-attachments field on Uploads. Or set AIRTABLE_SKIP_UPLOAD_ATTACHMENT=1.';
  }
  const mpNote =
    mp.status > 0
      ? ` Multipart retry: HTTP ${mp.status} ${typeof mp.data === 'object' && mp.data && 'error' in mp.data ? JSON.stringify((/** @type {any} */ (mp.data)).error) : JSON.stringify(mp.data)}.`
      : '';
  throw new Error(`Airtable attachment upload (${res.status}): ${msg}.${hint}${mpNote}`);
}

async function createMessageHistoryEntry(entry) {
  const table = process.env.AIRTABLE_MESSAGE_HISTORY_TABLE;
  if (!table || !String(table).trim()) return;

  const body = String(entry.body || '').slice(0, 10000);
  const fields = {
    'Company ID': entry.companyId,
    Phone: entry.phone,
    Direction: entry.direction,
    Body: body,
  };
  if (entry.eventType) {
    fields.Event = entry.eventType;
  }

  try {
    const b = getBase();
    await b(String(table).trim()).create([{ fields }]);
  } catch (err) {
    console.warn('[airtable] Message History:', err instanceof Error ? err.message : err);
  }
}

module.exports = {
  customerDataFields,
  customerCompanyIdIsLink,
  customerStatusValues,
  customerRewardDisplayText,
  campaignLogFields,
  campaignLogCompanyIdIsLink,
  campaignLogUsesCombinedCompanyPhone,
  campaignLogCombinedFieldName,
  campaignLogsTableName,
  getCompanyInfo,
  createUploadRecord,
  updateUploadStatus,
  createCustomerRecord,
  getAwaitingCustomers,
  updateCustomerStatus,
  checkDNC,
  createCampaignLog,
  createCampaignLogBestEffort,
  updateCampaignLog,
  getCampaignLogByPhone,
  getLatestCustomerForCompanyPhone,
  createMessageHistoryEntry,
  attachCsvToUploadRecord,
};
