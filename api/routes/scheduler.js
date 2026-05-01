/**
 * Scheduler dashboard routes:
 *   GET /scheduler/forecast?companyId=…&campaignType=…&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Computes a deterministic projection of the next N days of sends for one
 * (company, campaign). Side-effect free; reflects the current Awaiting queue
 * + already-sent count on each request.
 */

const express = require('express');
const { DateTime } = require('luxon');

const airtable = require('../services/airtable');
const scheduler = require('../services/scheduler');
const { logger } = require('../log');

const log = logger('scheduler-route');
const router = express.Router();

const FALLBACK_TZ = process.env.PIPER_DEFAULT_TIMEZONE || 'America/Phoenix';
const MAX_HORIZON_DAYS = 400; // ~13 months guard against runaway requests

function bad(res, msg) {
  return res.status(400).json({ error: msg });
}

router.get('/forecast', async (req, res) => {
  const companyId = String(req.query.companyId || '').trim();
  const campaignType = String(req.query.campaignType || '').trim();
  const startRaw = String(req.query.start || '').trim();
  const endRaw = String(req.query.end || '').trim();

  if (!companyId) return bad(res, 'companyId query parameter is required');
  if (!campaignType) return bad(res, 'campaignType query parameter is required');
  if (!startRaw) return bad(res, 'start query parameter is required (YYYY-MM-DD)');
  if (!endRaw) return bad(res, 'end query parameter is required (YYYY-MM-DD)');

  try {
    const company = await airtable.getCompanyInfo(companyId);
    if (!company) return res.status(404).json({ error: `Company not found: ${companyId}` });

    const tz = company.timezone || FALLBACK_TZ;
    const start = DateTime.fromISO(startRaw, { zone: tz }).startOf('day');
    const end = DateTime.fromISO(endRaw, { zone: tz }).startOf('day');
    if (!start.isValid || !end.isValid) {
      return bad(res, 'start / end must be valid YYYY-MM-DD dates');
    }
    if (end < start) return bad(res, 'end must be on or after start');
    const span = end.diff(start, 'days').days;
    if (span > MAX_HORIZON_DAYS) {
      return bad(res, `range too large (max ${MAX_HORIZON_DAYS} days)`);
    }

    const [queue, sentTodayCount] = await Promise.all([
      airtable.getAllAwaitingCustomersForCompanyAndCampaign(companyId, campaignType),
      airtable.countCampaignLogsToday(companyId, campaignType, new Date(), tz),
    ]);

    const days = scheduler.forecast({
      tz,
      sendOnHolidays: company.sendOnHolidays,
      queue,
      start: start.toISODate(),
      end: end.toISODate(),
      sentTodayCount,
      campaignType,
    });

    return res.json({
      companyId,
      campaignType,
      timezone: tz,
      sendOnHolidays: !!company.sendOnHolidays,
      queueSize: queue.length,
      sentToday: sentTodayCount,
      monthlyRate: scheduler.DEFAULT_MONTHLY_RATE,
      days,
    });
  } catch (err) {
    log.error('forecast failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Forecast failed',
    });
  }
});

module.exports = router;
