/**
 * Inbound webhook from Blooio.
 *
 * Flow when a customer texts back:
 *   1. Find the Campaign Logs row for this phone (last 10 digits FIND fallback).
 *   2. Mark "Replied At" + "Latest Reply".
 *   3. If the body is affirmative ("yes/y/sure/ok") → send the payload SMS,
 *      mark status "Payload Sent".
 *      Else → mark "Replied" and (optionally) send the inbound reminder.
 *
 * Production note: Blooio cannot reach http://localhost. The webhook URL must
 * be a public HTTPS endpoint (deployed API or ngrok). This file does not assume
 * any tunneling; it only requires the request to actually arrive.
 */

const express = require('express');
const airtable = require('../services/airtable');
const { getPayloadTemplate, replacePlaceholders, hasRewardOffer } =
  require('../services/templates');
const { sendSMS } = require('../services/sms');
const { FIELDS, STATUS, SERVER } = require('../config');
const { logger } = require('../log');

const log = logger('webhook');
const router = express.Router();

router.get('/', (_req, res) =>
  res.json({
    ok: true,
    info: 'POST Blooio message.received JSON here.',
    note: 'Must be reached over public HTTPS (deployed URL or ngrok).',
  })
);

/* ───────────────────────── parsing ───────────────────────── */

function isAffirmativeReply(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const t = raw.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === 'y' || /^yes\b/.test(t) || t === 'yeah' || t === 'yep' || t === 'yup') return true;
  if (/\byes\b/.test(t) || /\bsure\b/.test(t) || /\bok\b/.test(t) || /\bokay\b/.test(t))
    return true;
  return false;
}

function isInboundMessageEvent(event) {
  const raw = String(event || '').trim();
  if (!raw) return true; // tolerate proxies/curl that omit the event tag
  const n = raw.toLowerCase().replace(/[\s._-]/g, '');
  return n === 'messagereceived';
}

function pickFirst(layers, keys) {
  for (const L of layers) {
    if (!L || typeof L !== 'object') continue;
    for (const k of keys) {
      const v = L[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

/**
 * Pull the inbound shape out of any of the body / data / payload / message / object envelopes
 * that Blooio (and various proxies) may use.
 */
function parseInboundMessage(req) {
  const root = req.body && typeof req.body === 'object' ? req.body : {};
  const layers = [root, root.data, root.payload, root.message, root.object].filter(
    (x) => x && typeof x === 'object'
  );

  const headerEvent = String(req.headers['x-blooio-event'] || '').trim();
  const bodyEvent = pickFirst(layers, ['event']);
  const event = bodyEvent || headerEvent;

  if (!isInboundMessageEvent(event)) {
    return { type: 'skip', event: event || 'unknown' };
  }

  const text = pickFirst(layers, ['text', 'body', 'Body', 'content']);
  const from = pickFirst(layers, [
    'sender',
    'external_id',
    'chat_id',
    'from',
    'From',
    'phone',
    'identifier',
  ]);
  const rawTs = pickFirst(layers, ['received_at', 'timestamp', 'sent_at']);

  let repliedAt = null;
  if (rawTs) {
    const n = Number(rawTs);
    if (Number.isFinite(n) && n > 0) repliedAt = new Date(n).toISOString();
    else {
      const d = new Date(rawTs);
      if (!Number.isNaN(d.getTime())) repliedAt = d.toISOString();
    }
  }

  if (!from && !text && !Object.keys(root).length) {
    return { type: 'skip', event: 'empty' };
  }
  return {
    type: 'inbound',
    from,
    text,
    repliedAt,
    event: event || headerEvent || 'message.received',
  };
}

/**
 * Update Campaign Logs but tolerate columns that don't exist in the user's base.
 * Drops unknown fields and retries instead of aborting the inbound flow.
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

/* ───────────────────────── handler ───────────────────────── */

router.post('/', async (req, res) => {
  const startedMs = Date.now();
  log.info('POST received');

  if (SERVER.webhookLogBody) {
    try {
      log.info('body', { body: JSON.stringify(req.body).slice(0, 4000) });
    } catch {
      log.info('body', { body: '(unserializable)' });
    }
  }

  const parsed = parseInboundMessage(req);
  if (parsed.type === 'skip') {
    log.info('skip non-inbound event', { event: parsed.event });
    return res.status(200).json({ ok: true, ignored: parsed.event });
  }

  const { from, text, event, repliedAt } = parsed;

  // Always answer fast (200) so Blooio doesn't retry. Heavy work runs after the response.
  res.status(200).json({ ok: true });

  try {
    if (!from) {
      log.warn('inbound has no sender', { bodyHead: JSON.stringify(req.body).slice(0, 300) });
      return;
    }
    log.info('inbound', { from, event, textPreview: String(text).slice(0, 64) });

    const cl = await airtable.getCampaignLogByPhone(from);
    if (!cl) {
      log.warn('no Campaign Logs match for sender', {
        from,
        hint:
          'check that Blooio webhook URL hits this API and that Campaign Logs stores the same phone (e.g. +1XXXXXXXXXX)',
      });
      return;
    }
    log.info('campaign log matched', { logId: cl.id, companyId: cl.companyId });

    const company = cl.companyInfo || (await airtable.getCompanyInfo(cl.companyId));
    if (!company || !company.blooioApiKey) {
      log.error('no company / blooio key', { companyId: cl.companyId });
      return;
    }

    const customer = await airtable.getLatestCustomerForCompanyPhone(
      cl.companyId,
      from,
      company
    );
    const reward = customer ? hasRewardOffer(customer.reward) : false;
    const placeholders = {
      name: customer && customer.name != null ? String(customer.name).trim() : '',
      businessName: company.businessName || '',
      reviewLink: company.reviewLink || '',
      bookingLink: company.bookingLink || '',
      membershipLink: company.membershipLink || '',
      reward: customer ? airtable.customerRewardDisplayText(customer.reward) : '',
    };

    /** @type {Promise<unknown>[]} */
    const tasks = [];
    tasks.push(
      safeUpdateCampaignLog(cl.id, {
        [FIELDS.log.latestReply]: text,
        [FIELDS.log.repliedAt]: repliedAt || new Date().toISOString(),
      })
    );
    tasks.push(
      airtable.createMessageHistoryEntry({
        companyId: cl.companyId,
        phone: from,
        direction: 'Inbound',
        body: text,
        eventType: event,
      })
    );

    if (company.ownerMobile) {
      const ownerMsg = `Reply from ${from}: ${text}`.slice(0, 1600);
      tasks.push(
        sendSMS({
          apiKey: company.blooioApiKey,
          to: String(company.ownerMobile),
          text: ownerMsg,
        }).catch((e) => log.warn('owner notify failed', { err: e.message || String(e) }))
      );
    }

    if (!isAffirmativeReply(text)) {
      tasks.push(
        safeUpdateCampaignLog(cl.id, { [FIELDS.log.status]: STATUS.log.replied })
      );

      const reminder = replacePlaceholders(company.inboundReminderTemplate, placeholders).trim();
      if (reminder) {
        tasks.push(
          sendSMS({
            apiKey: company.blooioApiKey,
            to: from,
            text: reminder,
            idempotencyKey: `piper:remind:${cl.id}:${startedMs}`,
          }).catch((e) =>
            log.warn('inbound reminder send failed', { err: e.message || String(e) })
          )
        );
      }

      await Promise.allSettled(tasks);
      return;
    }

    // Affirmative reply → send the payload follow-up.
    const tpl = getPayloadTemplate(company, cl.campaignType, reward);
    const body = replacePlaceholders(tpl, placeholders).trim();
    if (!body) {
      log.warn('YES with empty payload template', {
        companyId: cl.companyId,
        campaign: cl.campaignType,
        reward,
      });
      tasks.push(
        safeUpdateCampaignLog(cl.id, { [FIELDS.log.status]: STATUS.log.replied })
      );
      await Promise.allSettled(tasks);
      return;
    }

    try {
      await sendSMS({
        apiKey: company.blooioApiKey,
        to: from,
        text: body,
        idempotencyKey: `piper:follow:${cl.id}:${startedMs}`,
      });
      log.info('payload sent', { to: from, ms: Date.now() - startedMs });
      tasks.push(
        safeUpdateCampaignLog(cl.id, { [FIELDS.log.status]: STATUS.log.payloadSent })
      );
    } catch (e) {
      log.error('payload send failed', {
        err: e instanceof Error ? e.message : String(e),
        to: from,
      });
      tasks.push(
        safeUpdateCampaignLog(cl.id, { [FIELDS.log.status]: STATUS.log.replied })
      );
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    log.error('handler error', { err: err instanceof Error ? err.message : String(err) });
  }
});

module.exports = router;
