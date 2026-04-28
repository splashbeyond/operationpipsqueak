/**
 * Manual outbound trigger (for cron or ops). Header: X-Processor-Secret.
 */

const express = require('express');
const { processOutboundBatch } = require('../services/outbound');
const { SERVER } = require('../config');
const { logger } = require('../log');

const log = logger('process');
const router = express.Router();

router.post('/', async (req, res) => {
  if (!SERVER.processorSecret) {
    return res.status(503).json({ error: 'PROCESSOR_SECRET is not configured' });
  }
  if (req.get('x-processor-secret') !== SERVER.processorSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const out = await processOutboundBatch(25);
    return res.json({ ok: true, ...out });
  } catch (err) {
    log.error('process failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Process failed' });
  }
});

module.exports = router;
