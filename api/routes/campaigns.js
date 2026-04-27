const express = require('express');

const airtable = require('../services/airtable');
const { listCampaignOptionsFromCompany } = require('../services/templates');

const router = express.Router();

/**
 * Comma-separated status labels for dashboard rollups (match Campaign Logs single-select exactly).
 */
function campaignLogStatusList(envKey, fallbackCsv) {
  return String(process.env[envKey] || fallbackCsv)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function campaignStatsStatusSets() {
  return {
    sent: campaignLogStatusList(
      'PIPER_STATS_CAMPAIGN_LOG_SENT',
      'Sent,Payload Sent,Handshake Sent'
    ),
    replied: campaignLogStatusList(
      'PIPER_STATS_CAMPAIGN_LOG_REPLIED',
      'Replied,Payload Sent,Needs Human Review,Completed'
    ),
    failed: campaignLogStatusList('PIPER_STATS_CAMPAIGN_LOG_FAILED', 'Failed,Failed/Opt-Out'),
  };
}

function requireCompanyId(req, res) {
  const companyId = req.query.companyId;
  if (!companyId || String(companyId).trim() === '') {
    res.status(400).json({ error: 'companyId query parameter is required' });
    return null;
  }
  return String(companyId).trim();
}

/** Handshake + payload availability per campaign, derived from the Company Info row (for upload UI). */
router.get('/campaign-types', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const company = await airtable.getCompanyInfo(companyId);
    if (!company) {
      return res.status(404).json({ error: `Company not found: ${companyId}` });
    }
    const campaigns = listCampaignOptionsFromCompany(company);
    const readyForUpload = campaigns.filter((c) => c.hasHandshake);
    return res.json({ companyId, campaigns, readyForUpload });
  } catch (err) {
    console.error('[campaigns/campaign-types]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const logs = await fetchCampaignLogsForCompany(companyId);
    const st = campaignStatsStatusSets();
    const totalSent = logs.filter((l) => l.status && st.sent.includes(String(l.status))).length;
    const totalReplied = logs.filter((l) => l.status && st.replied.includes(String(l.status)))
      .length;
    const totalFailed = logs.filter((l) => l.status && st.failed.includes(String(l.status)))
      .length;

    return res.json({
      logs,
      totalSent,
      totalReplied,
      totalFailed,
    });
  } catch (err) {
    console.error('[campaigns]', err);
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
    console.error('[campaigns/customers]', err);
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
    console.error('[campaigns/batches]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/stats', async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const logs = await fetchCampaignLogsForCompany(companyId);
    const st = campaignStatsStatusSets();
    const totalSent = logs.filter((l) => l.status && st.sent.includes(String(l.status))).length;
    const totalReplied = logs.filter((l) => l.status && st.replied.includes(String(l.status)))
      .length;
    const totalFailed = logs.filter((l) => l.status && st.failed.includes(String(l.status)))
      .length;
    const replyRate = totalSent > 0 ? totalReplied / totalSent : 0;

    const batches = await fetchUploadsForCompany(companyId);
    const activeBatches = batches.filter(
      (b) => b.status === 'Pending' || b.status === 'Processing'
    ).length;

    return res.json({
      totalSent,
      totalReplied,
      replyRate,
      totalFailed,
      activeBatches,
    });
  } catch (err) {
    console.error('[campaigns/stats]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

/** @type {typeof import('airtable')} */
let Airtable;
/** @type {() => import('airtable').Base} */
function getBase() {
  if (!Airtable) {
    Airtable = require('airtable');
  }
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    throw new Error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID');
  }
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  return Airtable.base(process.env.AIRTABLE_BASE_ID);
}

async function fetchCampaignLogsForCompany(companyId) {
  const b = getBase();
  const F = airtable.campaignLogFields();
  let formula;
  if (airtable.campaignLogUsesCombinedCompanyPhone()) {
    const cf = airtable.campaignLogCombinedFieldName();
    const esc = companyId.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    formula = `FIND('${esc}', {${cf}})`;
  } else if (airtable.campaignLogCompanyIdIsLink()) {
    const meta = await airtable.getCompanyInfo(companyId.trim());
    if (!meta) return [];
    const rid = meta.recordId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    formula = `{${F.companyId}} = '${rid}'`;
  } else {
    const esc = companyId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    formula = `{${F.companyId}} = '${esc}'`;
  }
  const records = await b(airtable.campaignLogsTableName())
    .select({
      filterByFormula: formula,
      maxRecords: 200,
    })
    .firstPage();

  const combined = airtable.campaignLogUsesCombinedCompanyPhone();
  const cf = airtable.campaignLogCombinedFieldName();

  return records.map((r) => {
    let phone = r.get(F.phone);
    if (combined) {
      const raw = r.get(cf);
      const str = String(raw ?? '');
      if (str.includes('|')) {
        phone = str.split('|').slice(1).join('|').trim();
      } else {
        phone = str;
      }
    }
    return {
      id: r.id,
      phone,
      campaignType: r.get(F.campaign),
      status: r.get(F.status),
      batchId: r.get(F.batchId),
      snapshotLinks: r.get(F.snapshotLinks),
      targetPayload: r.get(F.targetPayload),
      latestReply: r.get(F.latestReply),
      createdAt: r._rawJson?.createdTime || null,
    };
  });
}

async function fetchCustomersForCompany(companyId, status, batchId) {
  const CF = airtable.customerDataFields();
  const b = getBase();
  let esc;
  if (airtable.customerCompanyIdIsLink()) {
    const meta = await airtable.getCompanyInfo(companyId.trim());
    if (!meta) return [];
    esc = meta.recordId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  } else {
    esc = companyId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
  let formula = `{${CF.companyId}} = '${esc}'`;
  if (status) {
    const s = status.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    formula = `AND(${formula}, {${CF.status}} = '${s}')`;
  }
  if (batchId && process.env.AIRTABLE_CUSTOMER_OMIT_BATCH_ID !== '1') {
    const bid = batchId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    formula = `AND(${formula}, {${CF.batchId}} = '${bid}')`;
  }
  const records = await b('Customer Data')
    .select({ filterByFormula: formula, maxRecords: 200 })
    .firstPage();

  return records.map((r) => ({
    id: r.id,
    name: r.get(CF.name),
    phone: r.get(CF.phone),
    campaignType: r.get(CF.campaign),
    status: r.get(CF.status),
    batchId: r.get(CF.batchId),
  }));
}

async function fetchUploadsForCompany(companyId) {
  const company = await airtable.getCompanyInfo(companyId);
  if (!company) return [];

  const b = getBase();
  const rid = company.recordId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const esc = companyId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const linkField = process.env.AIRTABLE_UPLOAD_COMPANY_LINK_FIELD || 'Company';
  const cidField = process.env.AIRTABLE_UPLOAD_COMPANY_ID_FIELD || 'Company ID';
  const formula = `OR({${linkField}} = '${rid}', {${cidField}} = '${esc}')`;
  const records = await b('Uploads')
    .select({
      filterByFormula: formula,
      maxRecords: 100,
    })
    .firstPage();

  return records.map((r) => ({
    id: r.id,
    batchId: r.get('Batch ID'),
    status: r.get('Status'),
    createdAt: r._rawJson?.createdTime || null,
  }));
}

module.exports = router;
