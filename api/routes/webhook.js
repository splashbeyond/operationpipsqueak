const express = require('express');

const airtable = require('../services/airtable');
const { getPayloadTemplate, replacePlaceholders } = require('../services/templates');
const { sendSMS } = require('../services/sms');

const router = express.Router();

/**
 * Customer replied with an affirmative (handshake asked them to text Yes).
 * @param {string} text
 */
function isAffirmativeReply(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const t = raw.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === 'y' || /^yes\b/.test(t) || t === 'yeah' || t === 'yep' || t === 'yup') return true;
  if (/\byes\b/.test(t) || /\bsure\b/.test(t) || /\bok\b/.test(t) || /\bokay\b/.test(t)) return true;
  return false;
}

/**
 * Customer Data "Reward" may be checkbox, single select, or text.
 * @param {unknown} raw
 */
function rewardIsTruthy(raw) {
  if (raw === true) return true;
  if (raw === false || raw === null || raw === undefined) return false;
  const s = String(raw).trim().toLowerCase();
  if (!s) return false;
  if (['no', 'n', 'false', '0', 'none', 'no reward', 'without reward', 'n/a', 'na'].includes(s))
    return false;
  if (['yes', 'y', 'true', '1', 'reward', 'rewards'].includes(s)) return true;
  if (s.includes('no reward') || s.includes('without reward')) return false;
  // Free-text incentive (e.g. "$10 gift card") counts as reward offer
  return true;
}

/**
 * Blooio `message.received` shape + legacy/generic fallbacks.
 * @see https://docs.blooio.com/api-reference/webhook-events
 */
function parseInboundMessage(req) {
  const root = req.body && typeof req.body === 'object' ? req.body : {};
  const body = root.data && typeof root.data === 'object' ? root.data : root;

  const event = body.event || root.event;
  if (event && event !== 'message.received') {
    return { type: 'skip', event: String(event) };
  }

  const text = body.text ?? body.body ?? body.Body ?? root.text ?? '';
  const rawTs = body.received_at ?? body.timestamp ?? root.received_at ?? root.timestamp ?? null;
  const from =
    body.sender ||
    body.external_id ||
    body.from ||
    body.From ||
    body.phone ||
    root.sender ||
    root.external_id ||
    '';

  let repliedAt = null;
  if (rawTs !== null && rawTs !== undefined && String(rawTs).trim() !== '') {
    const n = Number(rawTs);
    if (Number.isFinite(n) && n > 0) {
      repliedAt = new Date(n).toISOString();
    } else {
      const d = new Date(String(rawTs));
      if (!Number.isNaN(d.getTime())) repliedAt = d.toISOString();
    }
  }

  if (!from && !text && Object.keys(root).length === 0) {
    return { type: 'skip', event: 'empty' };
  }

  return {
    type: 'inbound',
    from: from ? String(from) : '',
    text: text ? String(text) : '',
    repliedAt,
    event: event ? String(event) : 'message.received',
  };
}

/**
 * Update Campaign Logs but tolerate missing optional columns in Airtable.
 * Retries by removing unknown fields rather than aborting inbound automation.
 * @param {string} recordId
 * @param {Record<string, unknown>} fields
 */
async function safeUpdateCampaignLog(recordId, fields) {
  const payload = { ...fields };
  for (;;) {
    try {
      await airtable.updateCampaignLog(recordId, payload);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/Unknown field name:\s*"([^"]+)"/i);
      if (!m) throw err;
      const bad = m[1];
      if (!(bad in payload)) throw err;
      delete payload[bad];
      if (!Object.keys(payload).length) return;
    }
  }
}

router.post('/', async (req, res) => {
  const parsed = parseInboundMessage(req);
  const ts = new Date().toISOString();
  const startedMs = Date.now();

  if (parsed.type === 'skip') {
    return res.status(200).json({ ok: true, ignored: parsed.event });
  }

  const { from, text, event, repliedAt } = parsed;

  try {
    if (!from) {
      console.warn(`[webhook] ${ts} unknown sender (no phone)`, JSON.stringify(req.body).slice(0, 500));
      return res.status(200).json({ ok: true });
    }

    console.log(`[webhook] ${ts} inbound from=${from} event=${event}`);

    const log = await airtable.getCampaignLogByPhone(from);
    if (!log) {
      console.warn(`[webhook] ${ts} unknown sender phone=${from}`);
      return res.status(200).json({ ok: true });
    }

    const companyPromise = airtable.getCompanyInfo(log.companyId);
    const customerPromise = airtable.getLatestCustomerForCompanyPhone(log.companyId, from);
    const company = await companyPromise;
    if (!company || !company.blooioApiKey) {
      console.error(`[webhook] ${ts} missing company or API key for ${log.companyId}`);
      return res.status(200).json({ ok: true });
    }

    const customer = await customerPromise;
    const hasReward = customer ? rewardIsTruthy(customer.reward) : false;
    const customerName = customer && customer.name != null ? String(customer.name).trim() : '';
    const rewardText = customer ? airtable.customerRewardDisplayText(customer.reward) : '';

    const logFields = airtable.campaignLogFields();
    /** @type {Promise<unknown>[]} */
    const deferred = [];
    deferred.push(
      safeUpdateCampaignLog(log.id, {
        [logFields.latestReply]: text,
        [logFields.repliedAt]: repliedAt || ts,
      })
    );
    deferred.push(
      airtable.createMessageHistoryEntry({
        companyId: log.companyId,
        phone: from,
        direction: 'Inbound',
        body: text,
        eventType: event,
      })
    );

    const placeholderCtx = {
      name: customerName,
      businessName: company.businessName || '',
      reviewLink: company.reviewLink || '',
      bookingLink: company.bookingLink || '',
      membershipLink: company.membershipLink || '',
      reward: rewardText,
    };

    if (company.ownerMobile) {
      const ownerMsg = `Reply from ${from}: ${text}`.slice(0, 1600);
      deferred.push(
        (async () => {
          try {
            await sendSMS({
              apiKey: company.blooioApiKey,
              to: String(company.ownerMobile),
              text: ownerMsg,
            });
            await airtable.createMessageHistoryEntry({
              companyId: log.companyId,
              phone: String(company.ownerMobile),
              direction: 'Outbound',
              body: ownerMsg,
              eventType: 'owner_notify',
            });
          } catch (e) {
            console.error('[webhook] owner notify failed', e.message || e);
          }
        })()
      );
    }

    if (!isAffirmativeReply(text)) {
      deferred.push(
        safeUpdateCampaignLog(log.id, {
          [logFields.status]:
            process.env.AIRTABLE_WEBHOOK_CAMPAIGN_LOG_STATUS_REPLIED || 'Replied',
        })
      );

      const reminder = String(company.inboundReminderTemplate || '').trim();
      if (reminder) {
        const reminderBody = replacePlaceholders(reminder, placeholderCtx);
        if (reminderBody.trim()) {
          deferred.push(
            (async () => {
              try {
                await sendSMS({
                  apiKey: company.blooioApiKey,
                  to: from,
                  text: reminderBody,
                  idempotencyKey: `piper:remind:${log.id}:${ts}`,
                });
                await airtable.createMessageHistoryEntry({
                  companyId: log.companyId,
                  phone: from,
                  direction: 'Outbound',
                  body: reminderBody,
                  eventType: 'inbound_reminder',
                });
              } catch (e) {
                console.error('[webhook] inbound reminder send failed', e.message || e);
              }
            })()
          );
        }
      }

      void Promise.allSettled(deferred);
      return res.status(200).json({ ok: true });
    }

    const followTemplate = getPayloadTemplate(company, log.campaignType, hasReward);
    const followBody = replacePlaceholders(followTemplate, placeholderCtx);

    if (!followBody.trim()) {
      console.warn(
        `[webhook] ${ts} affirmative reply but no payload template (fill Payload Matrix (Reward)/(No Reward) or Payload Matrix) company=${log.companyId}`
      );
      deferred.push(
        safeUpdateCampaignLog(log.id, {
          [logFields.status]:
            process.env.AIRTABLE_WEBHOOK_CAMPAIGN_LOG_STATUS_REPLIED || 'Replied',
        })
      );
      void Promise.allSettled(deferred);
      return res.status(200).json({ ok: true });
    }

    try {
      await sendSMS({
        apiKey: company.blooioApiKey,
        to: from,
        text: followBody,
        idempotencyKey: `piper:follow:${log.id}:${ts}`,
      });
      console.log(`[webhook] YES payload sent in ${Date.now() - startedMs}ms to=${from}`);

      deferred.push(
        airtable.createMessageHistoryEntry({
          companyId: log.companyId,
          phone: from,
          direction: 'Outbound',
          body: followBody,
          eventType: 'payload_followup',
        })
      );
      deferred.push(
        safeUpdateCampaignLog(log.id, {
          [logFields.status]:
            process.env.AIRTABLE_WEBHOOK_CAMPAIGN_LOG_STATUS_PAYLOAD_SENT || 'Payload Sent',
        })
      );
    } catch (e) {
      console.error('[webhook] payload follow-up send failed', e.message || e);
      deferred.push(
        safeUpdateCampaignLog(log.id, {
          [logFields.status]:
            process.env.AIRTABLE_WEBHOOK_CAMPAIGN_LOG_STATUS_REPLIED || 'Replied',
        })
      );
    }

    void Promise.allSettled(deferred);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook]', err);
    return res.status(200).json({ ok: true });
  }
});

module.exports = router;
