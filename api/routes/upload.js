/**
 * CSV upload endpoint.
 *   1. Create Uploads row (status = Pending).
 *   2. Optionally attach the CSV file (skipped by default).
 *   3. Parse CSV → leads.
 *   4. For each lead: skip if on Global DNC, otherwise create a Customer Data row (Awaiting).
 *   5. Mark Uploads row Done.
 *
 * The outbound worker takes over from there.
 */

const express = require('express');
const multer = require('multer');

const airtable = require('../services/airtable');
const { processCSV } = require('../services/csv');
const { STATUS, FIELDS, OPTIONS } = require('../config');
const { logger } = require('../log');

const log = logger('upload');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

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
      const { leads, dataRowCount } = await processCSV(req.file.buffer);
      const batchId = batchName || uploadRecordId;

      let imported = 0;
      let skippedDnc = 0;

      for (const lead of leads) {
        const campaignType = defaultCampaignType || lead.campaignType || 'review';

        if (await airtable.checkDNC(lead.phone)) {
          skippedDnc++;
          continue;
        }

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
        });
        imported++;
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
        dataRowCount,
        validPhoneLeads: leads.length,
      });
      return res.json({
        ok: true,
        uploadId: uploadRecordId,
        imported,
        skippedDnc,
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
