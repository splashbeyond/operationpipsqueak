/**
 * Single source of truth for environment + Airtable schema.
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID.
 * Everything else has a sane default for the Piper "Universal CSV" base shape:
 *   Customer Data: Name, Phone Number, Campaign Type, Status, Company ID (link), Reward
 *   Campaign Logs: Company ID (link), Phone Number, Campaign Type, Status,
 *                  Latest Reply, Replied At, Handshake Sent At, Snapshot: Links, Target Payload
 *   Company Info: Company ID, Business Name, Blooio API Key & Phone, Handshake Matrix,
 *                 Payload Matrix (Reward), Payload Matrix (No Reward),
 *                 Booking Link, Review Link, Membership Link, Owner Mobile,
 *                 Per-campaign handshake/payload columns (see TEMPLATES below)
 *   Uploads: Status, Batch ID (optional), Company (link), Company ID (text)
 *   Global DNC: Phone Number
 */

require('./env');

/** @param {string | undefined} v */
const trim = (v) => (v == null ? '' : String(v).trim());

/** @param {string | undefined} v @param {string} fallback */
const str = (v, fallback) => {
  const t = trim(v);
  return t === '' ? fallback : t;
};

const flag = (v) => v === '1' || String(v).toLowerCase() === 'true';

const TABLES = {
  companyInfo: str(process.env.AIRTABLE_COMPANY_INFO_TABLE, 'Company Info'),
  uploads: str(process.env.AIRTABLE_UPLOADS_TABLE, 'Uploads'),
  customerData: str(process.env.AIRTABLE_CUSTOMER_DATA_TABLE, 'Customer Data'),
  campaignLogs: str(process.env.AIRTABLE_CAMPAIGN_LOG_TABLE, 'Campaign Logs'),
  globalDnc: str(process.env.AIRTABLE_GLOBAL_DNC_TABLE, 'Global DNC'),
  messageHistory: trim(process.env.AIRTABLE_MESSAGE_HISTORY_TABLE),
};

const FIELDS = {
  customer: {
    name: str(process.env.AIRTABLE_CUSTOMER_NAME_FIELD, 'Name'),
    phone: str(process.env.AIRTABLE_CUSTOMER_PHONE_FIELD, 'Phone Number'),
    campaign: str(process.env.AIRTABLE_CUSTOMER_CAMPAIGN_FIELD, 'Campaign Type'),
    status: str(process.env.AIRTABLE_CUSTOMER_STATUS_FIELD, 'Status'),
    companyId: str(process.env.AIRTABLE_CUSTOMER_COMPANY_ID_FIELD, 'Company ID'),
    batchId: str(process.env.AIRTABLE_CUSTOMER_BATCH_ID_FIELD, 'Batch ID'),
    reward: str(process.env.AIRTABLE_CUSTOMER_REWARD_FIELD, 'Reward'),
  },
  log: {
    companyId: str(process.env.AIRTABLE_CAMPAIGN_LOG_COMPANY_ID_FIELD, 'Company ID'),
    phone: str(
      process.env.AIRTABLE_CAMPAIGN_LOG_PHONE_FIELD,
      str(process.env.AIRTABLE_CUSTOMER_PHONE_FIELD, 'Phone Number')
    ),
    campaign: str(process.env.AIRTABLE_CAMPAIGN_LOG_CAMPAIGN_FIELD, 'Campaign Type'),
    status: str(process.env.AIRTABLE_CAMPAIGN_LOG_STATUS_FIELD, 'Status'),
    batchId: str(process.env.AIRTABLE_CAMPAIGN_LOG_BATCH_ID_FIELD, 'Batch ID'),
    snapshotLinks: str(
      process.env.AIRTABLE_CAMPAIGN_LOG_SNAPSHOT_LINKS_FIELD,
      'Snapshot: Links'
    ),
    latestReply: str(process.env.AIRTABLE_CAMPAIGN_LOG_LATEST_REPLY_FIELD, 'Latest Reply'),
    handshakeSentAt: str(
      process.env.AIRTABLE_CAMPAIGN_LOG_HANDSHAKE_SENT_AT_FIELD,
      'Handshake Sent At'
    ),
    repliedAt: str(process.env.AIRTABLE_CAMPAIGN_LOG_REPLIED_AT_FIELD, 'Replied At'),
    targetPayload: str(
      process.env.AIRTABLE_CAMPAIGN_LOG_TARGET_PAYLOAD_FIELD,
      'Target Payload'
    ),
  },
  upload: {
    status: str(process.env.AIRTABLE_UPLOAD_STATUS_FIELD, 'Status'),
    batchId: str(process.env.AIRTABLE_UPLOAD_BATCH_ID_FIELD, 'Batch ID'),
    companyLink: str(process.env.AIRTABLE_UPLOAD_COMPANY_LINK_FIELD, 'Company'),
    companyId: str(process.env.AIRTABLE_UPLOAD_COMPANY_ID_FIELD, 'Company ID'),
    rewardField: trim(process.env.AIRTABLE_UPLOAD_REWARD_FIELD),
    attachmentsField: str(process.env.AIRTABLE_UPLOAD_ATTACHMENTS_FIELD, 'Attachments'),
  },
  globalDnc: {
    phone: str(process.env.AIRTABLE_DNC_PHONE_FIELD, 'Phone Number'),
  },
};

const STATUS = {
  customer: {
    awaiting: str(process.env.AIRTABLE_CUSTOMER_STATUS_AWAITING, 'Awaiting'),
    processing: str(process.env.AIRTABLE_CUSTOMER_STATUS_PROCESSING, 'Processing'),
    sent: str(process.env.AIRTABLE_CUSTOMER_STATUS_SENT, 'Sent'),
    failed: str(process.env.AIRTABLE_CUSTOMER_STATUS_FAILED, 'Failed'),
  },
  upload: {
    initial: str(
      process.env.AIRTABLE_UPLOAD_INITIAL_STATUS,
      str(process.env.AIRTABLE_UPLOAD_STATUS_PENDING, 'Pending')
    ),
    done: str(process.env.AIRTABLE_UPLOAD_STATUS_DONE, 'Done'),
    failed: str(process.env.AIRTABLE_UPLOAD_STATUS_FAILED, 'Failed'),
  },
  log: {
    handshakeSent: str(process.env.AIRTABLE_OUTBOUND_CAMPAIGN_LOG_STATUS, 'Handshake Sent'),
    replied: str(process.env.AIRTABLE_WEBHOOK_CAMPAIGN_LOG_STATUS_REPLIED, 'Replied'),
    payloadSent: str(
      process.env.AIRTABLE_WEBHOOK_CAMPAIGN_LOG_STATUS_PAYLOAD_SENT,
      'Payload Sent'
    ),
  },
};

/** Behavior toggles (defaults match the Piper "Universal CSV" base). */
const OPTIONS = {
  customerCompanyIdIsLink: flag(process.env.AIRTABLE_CUSTOMER_COMPANY_ID_IS_LINK),
  customerOmitBatchId: flag(process.env.AIRTABLE_CUSTOMER_OMIT_BATCH_ID),
  customerOmitReward: flag(process.env.AIRTABLE_CUSTOMER_OMIT_REWARD),
  customerOmitCampaignOnCreate: flag(process.env.AIRTABLE_CUSTOMER_OMIT_CAMPAIGN_ON_CREATE),
  customerOmitProcessingLock: flag(process.env.AIRTABLE_CUSTOMER_OMIT_PROCESSING_LOCK),

  logCompanyIdIsLink: flag(process.env.AIRTABLE_CAMPAIGN_LOG_COMPANY_ID_IS_LINK),
  logOmitBatchId: flag(process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_BATCH_ID),
  logOmitCampaign: flag(process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_CAMPAIGN),
  logOmitTargetPayload: flag(process.env.AIRTABLE_CAMPAIGN_LOG_OMIT_TARGET_PAYLOAD),

  uploadOmitBatchId: flag(process.env.AIRTABLE_UPLOAD_OMIT_BATCH_ID),
  uploadOmitCompanyIdText: flag(process.env.AIRTABLE_UPLOAD_OMIT_COMPANY_ID_TEXT),
  uploadSkipCompanyLink: flag(process.env.AIRTABLE_UPLOAD_SKIP_COMPANY_LINK),
  uploadSkipAttachment: flag(process.env.AIRTABLE_SKIP_UPLOAD_ATTACHMENT),
};

/** Customer Data → Campaign Type select label per internal key (overrideable). */
const CUSTOMER_CAMPAIGN_OPTIONS = {
  review: str(process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REVIEW, 'Review'),
  no_show: str(process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_NO_SHOW, 'No-Show'),
  cancellation: str(
    process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_CANCELLATION,
    'Cancellation'
  ),
  reactivation: str(
    process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REACTIVATION,
    'Reactivation'
  ),
  referral: str(process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_REFERRAL, 'Referral'),
  upsell: str(process.env.AIRTABLE_CUSTOMER_CAMPAIGN_OPTION_UPSELL, 'Upsell'),
};

/** Canonical campaigns shown in the upload UI. */
const CAMPAIGNS = [
  { value: 'review', label: 'Review' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'upsell', label: 'Membership / upsell' },
  { value: 'referral', label: 'Referral' },
];

/** Internal campaign key from any user input ("Review", "No-Show", "no_show", etc.). */
function campaignKey(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  if (!k) return 'review';
  if (k === 'noshow') return 'no_show';
  if (k === 'membership' || k === 'membership_upsell') return 'upsell';
  if (k === 'cancel') return 'cancellation';
  return k;
}

/** Customer Data single-select label for a campaign key (with env override). */
function customerCampaignLabel(rawCampaign) {
  return CUSTOMER_CAMPAIGN_OPTIONS[campaignKey(rawCampaign)] || CUSTOMER_CAMPAIGN_OPTIONS.review;
}

/** Stats labels (Campaign Logs Status). */
function statusList(envKey, fallbackCsv) {
  return String(process.env[envKey] || fallbackCsv)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const STATS = {
  sent: statusList('PIPER_STATS_CAMPAIGN_LOG_SENT', 'Handshake Sent,Sent,Payload Sent'),
  replied: statusList(
    'PIPER_STATS_CAMPAIGN_LOG_REPLIED',
    'Replied,Payload Sent,Needs Human Review,Completed'
  ),
  failed: statusList('PIPER_STATS_CAMPAIGN_LOG_FAILED', 'Failed,Failed/Opt-Out'),
};

const SERVER = {
  port: Number(process.env.PORT) || 3000,
  processorIntervalSec: Math.max(5, Number(process.env.PROCESSOR_INTERVAL_SECONDS) || 60),
  disableInlineProcessor: flag(process.env.DISABLE_INLINE_PROCESSOR) || flag(process.env.VERCEL),
  processorSecret: trim(process.env.PROCESSOR_SECRET),
  blooioBaseUrl: str(process.env.BLOOIO_BASE_URL, 'https://backend.blooio.com/v2/api').replace(
    /\/$/,
    ''
  ),
  defaultSmsTemplate: trim(process.env.PIPER_DEFAULT_SMS_TEMPLATE),
  isProduction: process.env.NODE_ENV === 'production',
  enableDevTunnel: flag(process.env.ENABLE_DEV_TUNNEL),
  webhookLogBody: flag(process.env.WEBHOOK_LOG_BODY),
  webhookPublicUrl: trim(process.env.WEBHOOK_PUBLIC_URL),
};

function assertCoreEnv() {
  const missing = [];
  if (!trim(process.env.AIRTABLE_API_KEY)) missing.push('AIRTABLE_API_KEY');
  if (!trim(process.env.AIRTABLE_BASE_ID)) missing.push('AIRTABLE_BASE_ID');
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(', ')}. Set them in your platform's environment or .env.`
    );
  }
}

module.exports = {
  TABLES,
  FIELDS,
  STATUS,
  OPTIONS,
  STATS,
  SERVER,
  CAMPAIGNS,
  CUSTOMER_CAMPAIGN_OPTIONS,
  campaignKey,
  customerCampaignLabel,
  assertCoreEnv,
};
