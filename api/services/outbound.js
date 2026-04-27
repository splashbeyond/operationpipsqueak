const airtable = require('./airtable');
const { getTemplate, replacePlaceholders } = require('./templates');
const { sendSMS } = require('./sms');

function hasRewardOffer(raw) {
  if (raw === true) return true;
  if (raw === false || raw === null || raw === undefined) return false;
  const s = String(raw).trim().toLowerCase();
  if (!s) return false;
  if (['no', 'n', 'false', '0', 'none', 'no reward', 'without reward', 'n/a', 'na'].includes(s))
    return false;
  if (['yes', 'y', 'true', '1', 'reward', 'rewards'].includes(s)) return true;
  if (s.includes('no reward') || s.includes('without reward')) return false;
  return true;
}

function buildMessageBody(customer, company) {
  const template = getTemplate(company, customer.campaignType, hasRewardOffer(customer.reward));
  return replacePlaceholders(template, {
    name: customer.name,
    businessName: company.businessName || '',
    reviewLink: company.reviewLink || '',
    bookingLink: company.bookingLink || '',
    membershipLink: company.membershipLink || '',
    reward: airtable.customerRewardDisplayText(customer.reward),
  });
}

function placeholderPayload(customer, company) {
  return {
    name: customer.name,
    businessName: company.businessName || '',
    reviewLink: company.reviewLink || '',
    bookingLink: company.bookingLink || '',
    membershipLink: company.membershipLink || '',
    reward: airtable.customerRewardDisplayText(customer.reward),
  };
}

/**
 * Final SMS body; throws if empty so Blooio does not return a vague 400.
 * @param {{ name?: string, phone: string, campaignType?: string, companyId: string }} customer
 * @param {object} company from getCompanyInfo()
 */
function resolveOutboundBody(customer, company) {
  let text = buildMessageBody(customer, company);
  if (!String(text || '').trim()) {
    const fallback = process.env.PIPER_DEFAULT_SMS_TEMPLATE;
    if (fallback) {
      text = replacePlaceholders(fallback, placeholderPayload(customer, company));
    }
  }
  if (!String(text || '').trim()) {
    throw new Error(
      `Outbound SMS body is empty for campaign "${customer.campaignType || 'review'}". In Airtable → Company Info, fill the template for that campaign (e.g. "Review Template" for review). Placeholders: [Name], [Business Name], [Review Link], [Booking Link], [Membership Link]. Or set PIPER_DEFAULT_SMS_TEMPLATE in .env.`
    );
  }
  return text;
}

/**
 * Send one queued SMS: lock → create Campaign Log → send → mark Sent.
 * Returns true if work was done.
 */
async function processOneAwaitingCustomer() {
  const batch = await airtable.getAwaitingCustomers(1);
  if (!batch.length) return false;

  const customer = batch[0];
  const S = airtable.customerStatusValues();
  if (process.env.AIRTABLE_CUSTOMER_OMIT_PROCESSING_LOCK !== '1') {
    await airtable.updateCustomerStatus(customer.id, S.processing);
  }

  try {
    const company = await airtable.getCompanyInfo(customer.companyId);
    if (!company) {
      throw new Error(`Company not found: ${customer.companyId}`);
    }
    if (!company.blooioApiKey) {
      throw new Error(`Missing Blooio API key for company ${customer.companyId}`);
    }

    const text = resolveOutboundBody(customer, company);
    const idempotencyKey = `piper:${customer.id}:${customer.phone}`;
    const snapshotUrl =
      [company.reviewLink, company.bookingLink, company.membershipLink].find(
        (u) => u && String(u).trim() !== ''
      ) || '';

    // Hard gate: do not send if we cannot create a Campaign Logs row first.
    const logId = await airtable.createCampaignLogBestEffort({
      companyId: customer.companyId,
      phone: customer.phone,
      campaignType: customer.campaignType,
      batchId: customer.batchId,
      status: process.env.AIRTABLE_OUTBOUND_CAMPAIGN_LOG_STATUS || 'Sent',
      snapshotLinks: snapshotUrl ? String(snapshotUrl).trim() : undefined,
      messageBody: text,
      handshakeSentAt: new Date().toISOString(),
    });
    if (!logId) {
      throw new Error(
        'Campaign Logs row could not be created; SMS send skipped by policy (must log before send).'
      );
    }

    try {
      await sendSMS({
        apiKey: company.blooioApiKey,
        to: customer.phone,
        text,
        idempotencyKey,
      });
    } catch (err) {
      const isRateLimit =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        err.response &&
        err.response.status === 429;
      if (isRateLimit) {
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

    await airtable.updateCustomerStatus(customer.id, S.sent);
    console.log(
      `[outbound] ${new Date().toISOString()} sent campaign=${customer.campaignType} to=${customer.phone} status=Sent`
    );
    return true;
  } catch (err) {
    await airtable.updateCustomerStatus(customer.id, S.failed);
    throw err;
  }
}

/**
 * @param {number} [maxSends]
 */
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
  buildMessageBody,
  resolveOutboundBody,
};
