require('./env');

const express = require('express');
const cors = require('cors');

const uploadRouter = require('./routes/upload');
const webhookRouter = require('./routes/webhook');
const campaignsRouter = require('./routes/campaigns');
const processRouter = require('./routes/process');
const { startProcessor } = require('./jobs/processor');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) =>
  res.json({
    name: 'Piper API',
    ok: true,
    hint: 'This is the JSON backend only. Use the Vite app (e.g. http://localhost:5173) for the dashboard.',
    endpoints: {
      health: 'GET /health',
      upload: 'POST /upload',
      webhook: 'POST /webhook',
      campaigns: 'GET /campaigns?companyId=…',
      campaignTypes: 'GET /campaigns/campaign-types?companyId=…',
      process: 'POST /process',
    },
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/upload', uploadRouter);
app.use('/webhook', webhookRouter);
app.use('/campaigns', campaignsRouter);
app.use('/process', processRouter);

const PORT = Number(process.env.PORT) || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Piper API listening on ${PORT}`);
    if (process.env.VERCEL !== '1' && process.env.DISABLE_INLINE_PROCESSOR !== '1') {
      const intervalSec = Math.max(5, Number(process.env.PROCESSOR_INTERVAL_SECONDS) || 60);
      startProcessor(intervalSec);
      console.log(`Outbound processor started (every ${intervalSec}s)`);
    }
  });
}

module.exports = app;
