/**
 * Piper API entry point.
 *
 * Endpoints:
 *   GET  /            — service banner
 *   GET  /health      — liveness probe (returns 200)
 *   POST /upload       — CSV import (multipart + companyId; optional columnMapping JSON)
 *   POST /upload/preview — analyze CSV: suggested columns + sample normalized rows
 *   POST /webhook     — Blooio inbound (message.received)
 *   GET  /campaigns/* — dashboard read APIs
 *   POST /process     — manually run an outbound batch (needs PROCESSOR_SECRET)
 */

require('./env');

const express = require('express');
const cors = require('cors');

const uploadRouter = require('./routes/upload');
const webhookRouter = require('./routes/webhook');
const campaignsRouter = require('./routes/campaigns');
const processRouter = require('./routes/process');
const { startProcessor, stopProcessor } = require('./jobs/processor');
const { SERVER, assertCoreEnv } = require('./config');
const { logger } = require('./log');

const log = logger('piper');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.get('/', (_req, res) =>
  res.json({
    name: 'Piper API',
    ok: true,
    endpoints: {
      health: 'GET /health',
      upload: 'POST /upload',
      uploadPreview: 'POST /upload/preview',
      webhook: 'POST /webhook',
      campaigns: 'GET /campaigns?companyId=…',
      campaignTypes: 'GET /campaigns/campaign-types?companyId=…',
      process: 'POST /process',
    },
  })
);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/upload', uploadRouter);
app.use('/webhook', webhookRouter);
app.use('/campaigns', campaignsRouter);
app.use('/process', processRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Last-resort error handler — keeps the process alive instead of crashing on unexpected errors.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  log.error('unhandled', { err: err instanceof Error ? err.message : String(err) });
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal error' });
});

if (require.main === module) {
  try {
    assertCoreEnv();
  } catch (err) {
    log.error('boot failed', { err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  const server = app.listen(SERVER.port, async () => {
    log.info('listening', { port: SERVER.port, env: process.env.NODE_ENV || 'development' });

    if (SERVER.webhookPublicUrl) {
      const base = SERVER.webhookPublicUrl.replace(/\/$/, '');
      log.info('expected webhook URL', { url: `${base}/webhook` });
    } else if (!SERVER.isProduction) {
      log.info(
        'inbound webhook hint: deploy + set Blooio to https://<host>/webhook, or run npm run dev:tunnel for ngrok'
      );
    }

    if (SERVER.enableDevTunnel && !SERVER.isProduction) {
      try {
        const { startDevTunnel } = require('./dev-tunnel');
        await startDevTunnel(SERVER.port);
      } catch (e) {
        log.error('dev tunnel failed (run npm install for ngrok/localtunnel)', {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (!SERVER.disableInlineProcessor) {
      startProcessor(SERVER.processorIntervalSec);
      log.info('outbound processor started', { intervalSec: SERVER.processorIntervalSec });
    }
  });

  // Process-level safety nets — log and continue rather than die on a stray exception.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', {
      err: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', { err: err.message, stack: err.stack });
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown', { signal });
    stopProcessor();
    void (async () => {
      try {
        const { closeDevTunnel } = require('./dev-tunnel');
        await closeDevTunnel();
      } catch {
        /* noop */
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = app;
