/**
 * Outbound pacer / scheduler.
 *
 * Policy module that decides "may we send a text right now for this
 * (company, campaign)?" based on:
 *   - The business's local timezone & weekly send window.
 *   - US major holidays (skipped unless the business opts in).
 *   - A rolling ~500/month/campaign rate, with day-of-week weights:
 *       Mon 12:00–17:30  (5.5h, weight 0.79 — start late)
 *       Tue 10:30–17:30  (7.0h, weight 1.00 — best day)
 *       Wed 10:30–17:30  (7.0h, weight 1.00 — best day)
 *       Thu 10:30–17:30  (7.0h, weight 1.00 — best day)
 *       Fri 10:30–14:00  (3.5h, weight 0.50 — cut early)
 *       Sat 10:00–17:00  (7.0h, weight 1.00)
 *       Sun 11:00–16:00  (5.0h, weight 0.71 — conservative)
 *   - A soft catch-up cap (1.25× steady-state) so missed days don't blast.
 *   - Random-but-paced spacing inside the day's window.
 *
 * The module is intentionally side-effect free other than the three Airtable
 * read helpers it calls; the worker (outbound.js) decides what to do with the
 * verdict.
 */

const { DateTime } = require('luxon');
const airtable = require('./airtable');
const { logger } = require('../log');

const log = logger('scheduler');

/* ───────────────────────── policy constants ───────────────────────── */

/** Day-of-week → window. `weight` = window-hours / 7, the natural capacity proxy. */
const DAY_POLICY = {
  Mon: { open: '12:00', close: '17:30', weight: 5.5 / 7 },
  Tue: { open: '10:30', close: '17:30', weight: 7 / 7 },
  Wed: { open: '10:30', close: '17:30', weight: 7 / 7 },
  Thu: { open: '10:30', close: '17:30', weight: 7 / 7 },
  Fri: { open: '10:30', close: '14:00', weight: 3.5 / 7 },
  Sat: { open: '10:00', close: '17:00', weight: 7 / 7 },
  Sun: { open: '11:00', close: '16:00', weight: 5 / 7 },
};

const TOTAL_WEEKLY_WEIGHT = Object.values(DAY_POLICY).reduce((s, p) => s + p.weight, 0);
const AVG_DAILY_WEIGHT = TOTAL_WEEKLY_WEIGHT / 7;

const DEFAULT_MONTHLY_RATE = 500;
const ROLLING_DAYS = 30;
/** Catch-up rail: even after a missed day, today can't exceed 1.25× steady. */
const SOFT_CATCHUP_MULTIPLIER = 1.25;
/** Spacing jitter: ±20% of the average gap so cadence isn't mechanical. */
const SPACING_JITTER = 0.2;

/* Luxon: Mon=1..Sun=7. `weekday % 7` collapses Sun(7)→0, leaving 0..6 = Sun..Sat. */
const DOW_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ───────────────────────── holidays ───────────────────────── */

/**
 * Find the nth (1..4) or last (-1) occurrence of a weekday in a given month.
 * `weekday0to6`: Sun=0..Sat=6 (matches DOW_KEYS indexing).
 */
function nthWeekdayOfMonth(year, month1to12, weekday0to6, n) {
  if (n === -1) {
    const last = DateTime.fromObject({ year, month: month1to12, day: 1 }).endOf('month');
    for (let day = last.day; day >= 1; day -= 1) {
      const dt = DateTime.fromObject({ year, month: month1to12, day });
      if (dt.weekday % 7 === weekday0to6) return dt;
    }
    return null;
  }
  let count = 0;
  for (let day = 1; day <= 31; day += 1) {
    const dt = DateTime.fromObject({ year, month: month1to12, day });
    if (!dt.isValid) break;
    if (dt.weekday % 7 === weekday0to6) {
      count += 1;
      if (count === n) return dt;
    }
  }
  return null;
}

/** Fixed-date and floating major US holidays we skip unless overridden. */
function getMajorUSHolidays(year) {
  const memorialDay = nthWeekdayOfMonth(year, 5, 1, -1); // last Monday of May
  const laborDay = nthWeekdayOfMonth(year, 9, 1, 1); // first Monday of September
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4); // 4th Thursday of November
  return [
    DateTime.fromObject({ year, month: 1, day: 1 }), // New Year's Day
    memorialDay,
    DateTime.fromObject({ year, month: 6, day: 19 }), // Juneteenth
    DateTime.fromObject({ year, month: 7, day: 4 }), // Independence Day
    laborDay,
    thanksgiving,
    thanksgiving ? thanksgiving.plus({ days: 1 }) : null, // Black Friday
    DateTime.fromObject({ year, month: 12, day: 24 }), // Christmas Eve
    DateTime.fromObject({ year, month: 12, day: 25 }), // Christmas Day
    DateTime.fromObject({ year, month: 12, day: 31 }), // New Year's Eve
  ].filter(Boolean);
}

function isHoliday(localDate) {
  return getMajorUSHolidays(localDate.year).some((h) => h.hasSame(localDate, 'day'));
}

/* ───────────────────────── window math ───────────────────────── */

function getDayPolicy(localDate, sendOnHolidays = false) {
  const dowKey = DOW_KEYS[localDate.weekday % 7];
  const window = DAY_POLICY[dowKey];
  if (!window) return null;
  if (!sendOnHolidays && isHoliday(localDate)) return null;
  return { dow: dowKey, ...window };
}

function parseHHMM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return { hour: h, minute: m };
}

function windowBoundsLocal(localDate, policy) {
  const open = parseHHMM(policy.open);
  const close = parseHHMM(policy.close);
  return {
    open: localDate.set({ hour: open.hour, minute: open.minute, second: 0, millisecond: 0 }),
    close: localDate.set({ hour: close.hour, minute: close.minute, second: 0, millisecond: 0 }),
  };
}

/* ───────────────────────── target math ───────────────────────── */

/** Steady-state daily target for a given day weight, before queue/cap clamps. */
function steadyStateTargetFor(weight, monthlyRate = DEFAULT_MONTHLY_RATE) {
  return (monthlyRate / ROLLING_DAYS) * (weight / AVG_DAILY_WEIGHT);
}

/**
 * Today's send target with two safety rails:
 *   - Soft catch-up cap: ≤ 1.25× steady-state (downtime won't cause a blast).
 *   - Queue cap: never exceed contacts still queued (don't pad).
 *
 * The "forward-looking" property emerges automatically: a small queue (e.g. 80
 * contacts left) caps daily target = 80 on the last day rather than overshooting.
 */
function todayTarget({ weight, remainingQueue, monthlyRate = DEFAULT_MONTHLY_RATE }) {
  const steady = steadyStateTargetFor(weight, monthlyRate);
  const catchUpCap = Math.ceil(steady * SOFT_CATCHUP_MULTIPLIER);
  return Math.max(0, Math.min(catchUpCap, remainingQueue));
}

/* ───────────────────────── main gate ───────────────────────── */

/**
 * Decide whether the worker is allowed to send a message right now for
 * (company, campaignType). Side-effect free.
 *
 * @param {{
 *   now?: Date,
 *   tz: string,
 *   sendOnHolidays?: boolean,
 *   companyId: string,
 *   campaignType: string,
 *   monthlyRate?: number,
 * }} params
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: 'missing_timezone' | 'invalid_timezone' | 'closed_day' |
 *            'before_window' | 'after_window' | 'queue_empty' |
 *            'over_quota' | 'too_soon',
 *   target?: number,
 *   sentToday?: number,
 *   remainingQueue?: number,
 *   retryAfterMin?: number,
 * }>}
 */
async function canSendNow(params) {
  const {
    now = new Date(),
    tz,
    sendOnHolidays = false,
    companyId,
    campaignType,
    monthlyRate = DEFAULT_MONTHLY_RATE,
  } = params;

  if (!tz) return { ok: false, reason: 'missing_timezone' };

  const localNow = DateTime.fromJSDate(now).setZone(tz);
  if (!localNow.isValid) return { ok: false, reason: 'invalid_timezone' };

  const policy = getDayPolicy(localNow, sendOnHolidays);
  if (!policy) return { ok: false, reason: 'closed_day' };

  const { open, close } = windowBoundsLocal(localNow, policy);
  if (localNow < open) return { ok: false, reason: 'before_window' };
  if (localNow >= close) return { ok: false, reason: 'after_window' };

  const [remainingQueue, sentToday, lastSentAt] = await Promise.all([
    airtable.countAwaitingByCompanyAndCampaign(companyId, campaignType),
    airtable.countCampaignLogsToday(companyId, campaignType, now, tz),
    airtable.getLatestCampaignLogTime(companyId, campaignType, now, tz),
  ]);

  if (remainingQueue <= 0) {
    return { ok: false, reason: 'queue_empty', remainingQueue: 0 };
  }

  const target = todayTarget({ weight: policy.weight, remainingQueue, monthlyRate });
  if (sentToday >= target) {
    return { ok: false, reason: 'over_quota', target, sentToday, remainingQueue };
  }

  // Spacing: average gap = remaining-window-minutes / remaining-sends, ±20% jitter.
  if (lastSentAt) {
    const lastLocal = DateTime.fromJSDate(lastSentAt).setZone(tz);
    const remainingSends = Math.max(1, target - sentToday);
    const remainingMin = Math.max(1, close.diff(localNow, 'minutes').minutes);
    const avgGapMin = remainingMin / remainingSends;
    const jitterFactor = 1 - SPACING_JITTER + Math.random() * (2 * SPACING_JITTER);
    const minGapMin = Math.max(1, avgGapMin * jitterFactor);
    const elapsedMin = localNow.diff(lastLocal, 'minutes').minutes;
    if (elapsedMin < minGapMin) {
      return {
        ok: false,
        reason: 'too_soon',
        target,
        sentToday,
        remainingQueue,
        retryAfterMin: minGapMin - elapsedMin,
      };
    }
  }

  return { ok: true, target, sentToday, remainingQueue };
}

/* ───────────────────────── forecast ───────────────────────── */

/**
 * Pure forecast: walk forward day-by-day from `start` to `end`, applying the
 * same daily-target math as `canSendNow`, and assigning queued customers to
 * evenly-spaced slots inside each day's window.
 *
 * Side-effect free. Caller is responsible for fetching the queue + today's
 * sent count + tz/holiday flags. Times within a day are deterministic
 * (no random jitter) so repeated forecast calls don't shift the visible plan.
 *
 * @param {{
 *   tz: string,
 *   sendOnHolidays?: boolean,
 *   monthlyRate?: number,
 *   queue: Array<{ id:string, name?:string, phone?:string }>,
 *   start: string,                // YYYY-MM-DD (business-local)
 *   end: string,                  // YYYY-MM-DD (business-local), inclusive
 *   sentTodayCount?: number,      // count already-sent today, subtracted from today's target
 *   campaignType?: string,
 * }} params
 * @returns {Array<{
 *   date: string,
 *   dayOfWeek: string,
 *   isHoliday: boolean,
 *   isClosed: boolean,
 *   closedReason?: 'holiday' | 'no_window',
 *   window: { open: string, close: string, tz: string } | null,
 *   target: number,
 *   slots: Array<{
 *     scheduledLocal: string,     // HH:mm
 *     scheduledISO: string,       // full ISO with offset
 *     customerId: string,
 *     contactName: string,
 *     phoneLast4: string,
 *     campaignType?: string,
 *   }>,
 *   remainingQueueAfter: number,
 * }>}
 */
function forecast(params) {
  const {
    tz,
    sendOnHolidays = false,
    monthlyRate = DEFAULT_MONTHLY_RATE,
    queue,
    start,
    end,
    sentTodayCount = 0,
    campaignType,
  } = params;

  const startDate = DateTime.fromISO(start, { zone: tz }).startOf('day');
  const endDate = DateTime.fromISO(end, { zone: tz }).startOf('day');
  if (!startDate.isValid || !endDate.isValid || endDate < startDate) return [];

  const todayLocal = DateTime.now().setZone(tz).startOf('day');
  const result = [];
  let queueIdx = 0;

  for (let d = startDate; d <= endDate; d = d.plus({ days: 1 })) {
    const dowKey = DOW_KEYS[d.weekday % 7];
    const policy = getDayPolicy(d, sendOnHolidays);
    const isHol = isHoliday(d);
    const isPast = d < todayLocal;

    if (!policy) {
      result.push({
        date: d.toISODate(),
        dayOfWeek: dowKey,
        isHoliday: isHol,
        isClosed: true,
        closedReason: isHol ? 'holiday' : 'no_window',
        window: null,
        target: 0,
        slots: [],
        remainingQueueAfter: queue.length - queueIdx,
      });
      continue;
    }

    // Past days are skipped in the forecast — they already happened, the
    // Campaign Logs view is the source of truth for what actually shipped.
    if (isPast) {
      result.push({
        date: d.toISODate(),
        dayOfWeek: dowKey,
        isHoliday: isHol,
        isClosed: false,
        window: { open: policy.open, close: policy.close, tz },
        target: 0,
        slots: [],
        remainingQueueAfter: queue.length - queueIdx,
      });
      continue;
    }

    const remainingQueue = queue.length - queueIdx;
    let target = todayTarget({ weight: policy.weight, remainingQueue, monthlyRate });
    if (d.hasSame(todayLocal, 'day')) {
      target = Math.max(0, target - sentTodayCount);
    }

    const { open, close } = windowBoundsLocal(d, policy);
    const windowMin = close.diff(open, 'minutes').minutes;

    const slots = [];
    for (let i = 0; i < target && queueIdx < queue.length; i += 1) {
      // Even spacing: place each slot at the midpoint of its share of the window.
      // Yields N slots inside (open, close) with no slot exactly at open or close.
      const fraction = (i + 0.5) / target;
      const slotTime = open.plus({ minutes: windowMin * fraction });
      const customer = queue[queueIdx];
      const tail = String(customer.phone || '').replace(/\D/g, '').slice(-4);
      slots.push({
        scheduledLocal: slotTime.toFormat('HH:mm'),
        scheduledISO: slotTime.toISO(),
        customerId: customer.id,
        contactName: String(customer.name || '').trim() || 'Customer',
        phoneLast4: tail,
        campaignType: campaignType || undefined,
      });
      queueIdx += 1;
    }

    result.push({
      date: d.toISODate(),
      dayOfWeek: dowKey,
      isHoliday: isHol,
      isClosed: false,
      window: { open: policy.open, close: policy.close, tz },
      target: slots.length,
      slots,
      remainingQueueAfter: queue.length - queueIdx,
    });
  }

  return result;
}

module.exports = {
  canSendNow,
  forecast,
  // exposed for tests / debugging / ops dashboards
  DAY_POLICY,
  TOTAL_WEEKLY_WEIGHT,
  AVG_DAILY_WEIGHT,
  DEFAULT_MONTHLY_RATE,
  steadyStateTargetFor,
  todayTarget,
  getDayPolicy,
  isHoliday,
  getMajorUSHolidays,
  log,
};
