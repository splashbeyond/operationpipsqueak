/**
 * Read-only routes powering the dashboard:
 *   GET /campaigns/campaign-types?companyId=… — what's ready to upload
 *   GET /campaigns?companyId=…               — Campaign Logs list + counts
 *   GET /campaigns/customers?companyId=…     — Customer Data
 *   GET /campaigns/batches?companyId=…       — Uploads
 *   GET /campaigns/stats?companyId=…         — KPI tiles
 */

const express = require('express');
const Airtable = require('airtable');

const airtable = require('../services/airtable');
const { listCampaignOptionsFromCompany } = require('../services/templates');
const { TABLES, FIELDS, OPTIONS, STATS, assertCoreEnv } = require('../config');
const { logger } = require('../log');

const log = logger('campaigns');
const router = express.Router();

let _base;
function getBase() {
  if (_base) return _base;
  assertCoreEnv();
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  _base = Airtable.base(process.env.AIRTABLE_BASE_ID);
  return _base;
}

function escFormula(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function requireCompanyId(req, res) {
  const cid = req.query.companyId;
  if (!cid || String(cid).trim() === '') {
    res.status(400).json({ error: 'companyId query parameter is required' });
    return null;
  }
  return String(cid).trim();
}

function classifyCounts(logs) {
  const sent = logs.filter((l) => l.status && STATS.sent.includes(String(l.status))).length;
  const replied = logs.filter((l) => l.status && STATS.replied.includes(String(l.status))).length;
  const failed = logs.filter((l) => l.status && STATS.failed.includes(String(l.status))).length;
  return { sent, replied, failed };
}

async function fetchCampaignLogsForCompany(companyId) {
  const F = FIELDS.log;
  let formula;
  if (OPTIONS.logCompanyIdIsLink) {
    const meta = await airtable.getCompanyInfo(companyId);
    if (!meta) return [];
    formula = `{${F.companyId}} = '${escFormula(meta.recordId)}'`;
  } else {
    formula = `{${F.companyId}} = '${escFormula(companyId)}'`;
  }
  const records = await getBase()(TABLES.campaignLogs)
    .select({ filterByFormula: formula, maxRecords: 200 })
    .firstPage();

  return records.map((r) => ({
    id: r.id,
    phone: r.get(F.phone),
    campaignType: r.get(F.campaign),
    status: r.get(F.status),
    batchId: r.get(F.batchId),
    snapshotLinks: r.get(F.snapshotLinks),
    targetHandshake: r.get(F.targetHandshake),
    targetPayload: r.get(F.targetPayload),
    latestReply: r.get(F.latestReply),
    createdAt: r._rawJson?.createdTime || null,
  }));
}

async function fetchCustomersForCompany(companyId, status, batchId) {
  const CF = FIELDS.customer;
  let companyFilter;
  if (OPTIONS.customerCompanyIdIsLink) {
    const meta = await airtable.getCompanyInfo(companyId);
    if (!meta) return [];
    companyFilter = `{${CF.companyId}} = '${escFormula(meta.recordId)}'`;
  } else {
    companyFilter = `{${CF.companyId}} = '${escFormula(companyId)}'`;
  }

  const clauses = [companyFilter];
  if (status) clauses.push(`{${CF.status}} = '${escFormula(status)}'`);
  if (batchId && !OPTIONS.customerOmitBatchId) {
    clauses.push(`{${CF.batchId}} = '${escFormula(batchId)}'`);
  }
  const formula = clauses.length === 1 ? clauses[0] : `AND(${clauses.join(', ')})`;

  const records = await getBase()(TABLES.customerData)
    .select({ filterByFormula: formula, maxRecords: 200 })
    .firstPage();

  return records.map((r) => ({
    id: r.id,
    name: r.get(CF.name),
    phone: r.get(CF.phone),
    campaignType: r.get(CF.campaign),
    status: r.get(CF.status),
    batchId: r.get(CF.batchId),
    latestCustomerReply: CF.latestCustomerReply ? r.get(CF.latestCustomerReply) : undefined,
    latestSystemReply: CF.latestSystemReply ? r.get(CF.latestSystemReply) : undefined,
  }));
}

async function fetchUploadsForCompany(companyId) {
  const company = await airtable.getCompanyInfo(companyId);
  if (!company) return [];

  const F = FIELDS.upload;
  const formula = `OR({${F.companyLink}} = '${escFormula(company.recordId)}', {${F.companyId}} = '${escFormula(
    companyId
  )}')`;
  const records = await getBase()(TABLES.uploads)
    .select({ filterByFormula: formula, maxRecords: 100 })
    .firstPage();

  return records.map((r) => ({
    id: r.id,
    batchId: r.get(F.batchId),
    batchName: F.batchName ? r.get(F.batchName) : undefined,
    status: r.get(F.status),
    totalLeads: F.totalLeads ? r.get(F.totalLeads) : undefined,
    createdAt: r._rawJson?.createdTime || null,
  }));
}

router.get('/campaign-types', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const company = await airtable.getCompanyInfo(companyId);
    if (!company) return res.status(404).json({ error: `Company not found: ${companyId}` });
    const campaigns = listCampaignOptionsFromCompany(company);
    return res.json({
      companyId,
      campaigns,
      readyForUpload: campaigns.filter((c) => c.hasHandshake),
    });
  } catch (err) {
    log.error('campaign-types failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const logs = await fetchCampaignLogsForCompany(companyId);
    const counts = classifyCounts(logs);
    return res.json({
      logs,
      totalSent: counts.sent,
      totalReplied: counts.replied,
      totalFailed: counts.failed,
    });
  } catch (err) {
    log.error('logs failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/customers', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const status = req.query.status ? String(req.query.status) : null;
  const batchId = req.query.batchId ? String(req.query.batchId) : null;
  try {
    const customers = await fetchCustomersForCompany(companyId, status, batchId);
    return res.json({ customers, total: customers.length });
  } catch (err) {
    log.error('customers failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/batches', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const batches = await fetchUploadsForCompany(companyId);
    return res.json({ batches });
  } catch (err) {
    log.error('batches failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/templates', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const data = await airtable.getCompanyTemplates(companyId);
    if (!data) return res.status(404).json({ error: `Company not found: ${companyId}` });
    return res.json({
      ...data,
      placeholders: ['[Name]', '[Business Name]', '[Review Link]', '[Booking Link]', '[Membership Link]', '[Reward]'],
    });
  } catch (err) {
    log.error('templates get failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.patch('/templates', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const { kind, campaign, variant, value } = req.body || {};
  if (!kind || !campaign || !variant) {
    return res.status(400).json({ error: 'kind, campaign, and variant are required' });
  }
  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'value must be a string' });
  }
  try {
    const result = await airtable.updateCompanyTemplate(
      companyId,
      String(kind),
      String(campaign),
      String(variant),
      value
    );
    return res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    log.error('templates patch failed', { err: msg, kind, campaign, variant });
    return res.status(400).json({ error: msg });
  }
});

router.get('/stats', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const [logs, batches] = await Promise.all([
      fetchCampaignLogsForCompany(companyId),
      fetchUploadsForCompany(companyId),
    ]);
    const counts = classifyCounts(logs);
    const replyRate = counts.sent > 0 ? counts.replied / counts.sent : 0;
    const activeBatches = batches.filter(
      (b) => b.status === 'Pending' || b.status === 'Processing'
    ).length;
    return res.json({
      totalSent: counts.sent,
      totalReplied: counts.replied,
      replyRate,
      totalFailed: counts.failed,
      activeBatches,
    });
  } catch (err) {
    log.error('stats failed', { err: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

module.exports = router;
