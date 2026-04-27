const express = require('express');
const { processOutboundBatch } = require('../services/outbound');

const router = express.Router();

router.post('/', async (req, res) => {
  const expected = process.env.PROCESSOR_SECRET;
  if (!expected || String(expected).trim() === '') {
    return res.status(503).json({ error: 'PROCESSOR_SECRET is not configured' });
  }

  const provided = req.get('x-processor-secret');
  if (provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const out = await processOutboundBatch(25);
    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[process]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Process failed' });
  }
});

module.exports = router;
