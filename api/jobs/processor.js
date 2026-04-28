/**
 * Outbound processor — periodically drains "Awaiting" Customer Data rows.
 * Started by api/index.js in normal deployments. Disable with DISABLE_INLINE_PROCESSOR=1
 * if you'd rather drive it via cron POST /process.
 */

const { processOutboundBatch } = require('../services/outbound');
const { logger } = require('../log');

const log = logger('processor');

let intervalHandle = /** @type {ReturnType<typeof setInterval> | null} */ (null);
let running = false;

async function tick() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    const out = await processOutboundBatch(25);
    if (out.processed > 0) log.info('tick', { processed: out.processed, ms: Date.now() - started });
  } catch (err) {
    log.error('tick error', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

/** @param {number} intervalSeconds */
function startProcessor(intervalSeconds = 60) {
  if (intervalHandle) return;
  const ms = Math.max(Number(intervalSeconds) || 60, 5) * 1000;
  intervalHandle = setInterval(() => void tick(), ms);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
  void tick();
}

function stopProcessor() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startProcessor, stopProcessor, tick, _isRunning: () => running };
