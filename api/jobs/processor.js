const { processOutboundBatch } = require('../services/outbound');

let intervalHandle = /** @type {ReturnType<typeof setInterval> | null} */ (null);
let running = false;

/**
 * @param {number} intervalSeconds
 */
function startProcessor(intervalSeconds = 60) {
  if (intervalHandle) return;

  const ms = Math.max(Number(intervalSeconds) || 60, 5) * 1000;

  intervalHandle = setInterval(() => {
    void tick();
  }, ms);

  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }

  void tick();
}

function stopProcessor() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function tick() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    await processOutboundBatch(25);
  } catch (err) {
    console.error('[processor]', new Date().toISOString(), err.message || err);
  } finally {
    const ms = Date.now() - started;
    console.log(`[processor] tick done in ${ms}ms`);
    running = false;
  }
}

module.exports = {
  startProcessor,
  stopProcessor,
  tick,
  /** @internal */
  _isRunning: () => running,
};
