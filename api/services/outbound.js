/**
 * Outbound worker — picks the next "Awaiting" Customer Data row,
 * creates a Campaign Logs row, sends the handshake SMS, marks status.
 *
 * Handshake dedupe: (1) same Batch ID + company + phone + campaign — only the
 * earliest Customer Data row may send (parallel-safe before Campaign Logs exist).
 * (2) Campaign Logs lane in a blocking status (see HANDSHAKE_DEDUPE).
 */

const airtable = require('./airtable');
const scheduler = require('./scheduler');
const {
  getHandshakeTemplate,
  hasRewardOffer,
  replacePlaceholders,
} = require('./templates');
const { sendSMS } = require('./sms');
const { STATUS, OPTIONS, SERVER, FIELDS } = require('../config');
const { logger } = require('../log');

const log = logger('outbound');

/** Default timezone if a Company Info row hasn't picked one yet. */
const FALLBACK_TZ = process.env.PIPER_DEFAULT_TIMEZONE || 'America/Phoenix';

function buildPlaceholderCtx(customer, company) {
  return {
    name: customer.name || '',
    businessName: company.businessName || '',
    reviewLink: company.reviewLink || '',
    bookingLink: company.bookingLink || '',
    membershipLink: company.membershipLink || '',
    reward: airtable.customerRewardDisplayText(customer.reward),
  };
}

function resolveOutboundBody(customer, company) {
  const tpl = getHandshakeTemplate(
    company,
    customer.campaignType,
    hasRewardOffer(customer.reward)
  );
  let text = replacePlaceholders(tpl, buildPlaceholderCtx(customer, company));
  if (!String(text).trim() && SERVER.defaultSmsTemplate) {
    text = replacePlaceholders(SERVER.defaultSmsTemplate, buildPlaceholderCtx(customer, company));
  }
  if (!String(text).trim()) {
    throw new Error(
      `Outbound SMS body is empty for campaign "${customer.campaignType || 'review'}". ` +
        'Fill the matching Handshake template in Company Info, or set PIPER_DEFAULT_SMS_TEMPLATE.'
    );
  }
  return text;
}

/** Send one queued SMS. Returns true if work was done. */
async function processOneAwaitingCustomer() {
  const batch = await airtable.getAwaitingCustomers(1);
  if (!batch.length) return false;

  const customer = batch[0];

  try {
    const company = await airtable.getCompanyInfo(customer.companyId);
    if (!company) throw new Error(`Company not found: ${customer.companyId}`);
    if (!company.blooioApiKey) {
      throw new Error(`Missing Blooio API key for company ${customer.companyId}`);
    }

    // Scheduler gate: window + holiday + per-day target + spacing.
    // Side-effect free — if blocked, customer stays Awaiting and the worker
    // tries again on the next tick.
    const decision = await scheduler.canSendNow({
      tz: company.timezone || FALLBACK_TZ,
      sendOnHolidays: company.sendOnHolidays,
      companyId: customer.companyId,
      campaignType: customer.campaignType,
    });
    if (!decision.ok) {
      log.info('scheduler gated', {
        reason: decision.reason,
        companyId: customer.companyId,
        campaign: customer.campaignType,
        target: decision.target,
        sentToday: decision.sentToday,
        remainingQueue: decision.remainingQueue,
        retryAfterMin: decision.retryAfterMin,
      });
      return false;
    }

    const earlierDup = await airtable.hasEarlierActiveCustomerHandshakeDuplicate(
      customer,
      company
    );
    if (earlierDup) {
      log.info('handshake dedupe: skip (earlier customer row same batch)', {
        companyId: customer.companyId,
        phone: customer.phone,
        campaign: customer.campaignType,
        batchId: customer.batchId,
      });
      await airtable.markCustomerHandshakeDedupeSkip(customer.id);
      return true;
    }

    if (!OPTIONS.customerOmitProcessingLock) {
      await airtable.updateCustomerStatus(customer.id, STATUS.customer.processing);
    }

    const blocked = await airtable.hasBlockingCampaignLane(
      customer.companyId,
      customer.phone,
      customer.campaignType,
      company
    );
    if (blocked) {
      log.info('handshake dedupe: skip (existing lane)', {
        companyId: customer.companyId,
        phone: customer.phone,
        campaign: customer.campaignType,
      });
      await airtable.markCustomerHandshakeDedupeSkip(customer.id);
      return true;
    }

    const text = resolveOutboundBody(customer, company);
    const idempotencyKey = `piper:${customer.id}:${customer.phone}`;
    const snapshotUrl = OPTIONS.logOmitSnapshotLinks
      ? ''
      : [company.reviewLink, company.bookingLink, company.membershipLink].find(
          (u) => u && String(u).trim() !== ''
        ) || '';

    const logId = await airtable.createCampaignLog({
      companyId: customer.companyId,
      phone: customer.phone,
      campaignType: customer.campaignType,
      batchId: customer.batchId,
      status: STATUS.log.handshakeSent,
      snapshotLinks: snapshotUrl ? String(snapshotUrl).trim() : undefined,
      messageBody: text,
      handshakeSentAt: new Date().toISOString(),
    });
    if (!logId) {
      throw new Error('Could not create Campaign Logs row; SMS skipped (must log before send).');
    }

    try {
      await sendSMS({ apiKey: company.blooioApiKey, to: customer.phone, text, idempotencyKey });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        await sendSMS({
          apiKey: company.blooioApiKey,
          to: customer.phone,
          text,
          idempotencyKey: `${idempotencyKey}:retry`,
        });
      } else {
        throw err;
      }
    }

    const customerDoneFields = { [FIELDS.customer.status]: STATUS.customer.sent };
    if (!OPTIONS.customerOmitConversationMirror && FIELDS.customer.latestSystemReply) {
      customerDoneFields[FIELDS.customer.latestSystemReply] = String(text).trim().slice(0, 100000);
    }
    await airtable.updateCustomerFields(customer.id, customerDoneFields);
    log.info('handshake sent', {
      campaign: customer.campaignType,
      to: customer.phone,
      logId,
    });
    return true;
  } catch (err) {
    await airtable.updateCustomerStatus(customer.id, STATUS.customer.failed);
    log.error('handshake send failed', {
      err: err instanceof Error ? err.message : String(err),
      to: customer.phone,
    });
    throw err;
  }
}

async function processOutboundBatch(maxSends = 25) {
  const n = Math.min(Math.max(Number(maxSends) || 25, 1), 100);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const worked = await processOneAwaitingCustomer();
    if (!worked) break;
    count++;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { processed: count };
}

module.exports = {
  processOneAwaitingCustomer,
  processOutboundBatch,
  resolveOutboundBody,
};
