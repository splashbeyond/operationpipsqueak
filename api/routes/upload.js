/**
 * CSV upload endpoint.
 *   1. Create Uploads row (status = Pending).
 *   2. Optionally attach the CSV file (skipped by default).
 *   3. Parse CSV → leads.
 *   4. For each lead: skip if on Global DNC; duplicate phone+campaign in the same CSV →
 *      Customer Data row with Skipped Duplicate (first row in file is Awaiting). Otherwise Awaiting.
 *   5. Mark Uploads row Done.
 *
 * The outbound worker takes over from there.
 */

const express = require('express');
const multer = require('multer');

const airtable = require('../services/airtable');
const {
  processCSV,
  parseCSV,
  extractLeads,
  coerceHeaderMap,
  previewCSV,
} = require('../services/csv');
const { STATUS, FIELDS, OPTIONS, campaignKey } = require('../config');
const { logger } = require('../log');

const log = logger('upload');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** Last 10 digits — must match outbound / Airtable FIND dedupe. */
function phoneLast10(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** One outbound lane per upload: phone + campaign key (same scope as Campaign Logs dedupe). */
function handshakeLaneKey(phone, campaignType) {
  const ten = phoneLast10(phone);
  if (!ten) return null;
  return `${ten}|${campaignKey(campaignType)}`;
}

function errorMessage(err) {
  if (!err) return 'Upload failed';
  if (err instanceof Error) return err.message || 'Upload failed';
  if (typeof err === 'string') return err;
  const e = err.error || err;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  try {
    return JSON.stringify(err.error != null ? err.error : err).slice(0, 800) || 'Upload failed';
  } catch {
    return 'Upload failed';
  }
}

/**
 * POST /upload/preview — multipart file (+ optional columnMapping JSON to refresh preview).
 * Returns headers, suggested column mapping (AI + heuristics), and first rows normalized.
 */
router.post(
  '/preview',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'File upload error' });
      next();
    });
  },
  async (req, res) => {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'CSV file is required (field name: file)' });
    }
    try {
      let override = null;
      const rawMap = req.body.columnMapping;
      if (rawMap != null && String(rawMap).trim() !== '') {
        const { headers } = parseCSV(req.file.buffer);
        let parsed;
        try {
          parsed = JSON.parse(String(rawMap));
        } catch {
          return res.status(400).json({ error: 'columnMapping must be valid JSON' });
        }
        override = coerceHeaderMap(parsed, headers);
      }
      const out = await previewCSV(req.file.buffer, override, 15);
      return res.json({ ok: true, ...out });
    } catch (err) {
      log.error('preview failed', { err: errorMessage(err) });
      return res.status(500).json({ error: errorMessage(err) });
    }
  }
);

router.post(
  '/',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'File upload error' });
      next();
    });
  },
  async (req, res) => {
    const companyId = String(req.body.companyId || '').trim();
    const batchName = req.body.batchName ? String(req.body.batchName).trim() : '';
    const defaultCampaignType = req.body.campaignType
      ? String(req.body.campaignType).trim()
      : '';
    const batchReward =
      req.body.reward !== undefined && req.body.reward !== null
        ? String(req.body.reward).trim()
        : '';

    if (!companyId) return res.status(400).json({ error: 'companyId is required' });
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'CSV file is required (field name: file)' });
    }

    let uploadRecordId = null;
    let step = 'createUploadsRow';
    try {
      uploadRecordId = await airtable.createUploadRecord(companyId, batchName, {
        reward: batchReward,
      });

      step = 'attachCsvToAirtable';
      let attachmentError = null;
      try {
        await airtable.attachCsvToUploadRecord(
          uploadRecordId,
          req.file.originalname || 'upload.csv',
          req.file.buffer
        );
      } catch (err) {
        attachmentError = errorMessage(err);
        log.warn('Airtable Attachments field failed', { err: attachmentError });
      }

      step = 'parseCsv';
      const mappingRaw = req.body.columnMapping;
      let leads;
      let dataRowCount;
      if (mappingRaw != null && String(mappingRaw).trim() !== '') {
        let userMap;
        try {
          userMap = JSON.parse(String(mappingRaw));
        } catch {
          return res.status(400).json({ error: 'columnMapping must be valid JSON' });
        }
        const parsed = parseCSV(req.file.buffer);
        const headerMap = coerceHeaderMap(userMap, parsed.headers);
        if (!headerMap.phone) {
          return res.status(400).json({
            error: 'Column mapping must include a Phone column from your CSV headers.',
          });
        }
        leads = extractLeads(parsed.rows, headerMap);
        dataRowCount = parsed.rows.length;
      } else {
        const parsed = await processCSV(req.file.buffer);
        leads = parsed.leads;
        dataRowCount = parsed.dataRowCount;
      }
      const batchId = batchName || uploadRecordId;

      let imported = 0;
      let skippedDnc = 0;
      let skippedDuplicate = 0;
      /** First row in this CSV per phone+campaign becomes Awaiting; later dupes → Skipped Duplicate. */
      const seenHandshakeLane = new Set();

      for (const lead of leads) {
        const campaignType = defaultCampaignType || lead.campaignType || 'review';

        if (await airtable.checkDNC(lead.phone)) {
          skippedDnc++;
          continue;
        }

        const laneKey = handshakeLaneKey(lead.phone, campaignType);
        const isCsvDuplicate = laneKey != null && seenHandshakeLane.has(laneKey);
        if (laneKey && !isCsvDuplicate) seenHandshakeLane.add(laneKey);

        step = 'createCustomerRow';
        const rowReward =
          lead.reward && String(lead.reward).trim() !== '' ? lead.reward : batchReward;
        await airtable.createCustomerRecord({
          name: lead.name,
          phone: lead.phone,
          campaignType,
          companyId,
          batchId,
          reward: rowReward || undefined,
          ...(isCsvDuplicate ? { status: STATUS.customer.skipped } : {}),
        });
        if (isCsvDuplicate) skippedDuplicate++;
        else imported++;
      }

      step = 'markUploadDone';
      const doneExtra = OPTIONS.uploadOmitTotalLeads
        ? {}
        : { [FIELDS.upload.totalLeads]: dataRowCount };
      await airtable.updateUploadStatus(uploadRecordId, STATUS.upload.done, doneExtra);

      log.info('upload complete', {
        companyId,
        uploadId: uploadRecordId,
        imported,
        skippedDnc,
        skippedDuplicate,
        dataRowCount,
        validPhoneLeads: leads.length,
      });
      return res.json({
        ok: true,
        uploadId: uploadRecordId,
        imported,
        skippedDnc,
        skippedDuplicate,
        totalLeads: dataRowCount,
        validPhoneLeads: leads.length,
        attachmentError,
      });
    } catch (err) {
      log.error('upload failed', { step, err: errorMessage(err) });
      if (uploadRecordId) {
        try {
          await airtable.updateUploadStatus(uploadRecordId, STATUS.upload.failed);
        } catch (e2) {
          log.warn('failed to mark upload Failed', { err: errorMessage(e2) });
        }
      }
      return res.status(500).json({ error: `[${step}] ${errorMessage(err)}` });
    }
  }
);

module.exports = router;
