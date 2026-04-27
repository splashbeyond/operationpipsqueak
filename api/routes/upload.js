const express = require('express');
const multer = require('multer');

const airtable = require('../services/airtable');
const { processCSV } = require('../services/csv');

const router = express.Router();

function errorMessage(err) {
  if (!err) return 'Upload failed';
  if (err instanceof Error) return err.message || 'Upload failed';
  const e = err.error || err;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  if (typeof err === 'string') return err;
  try {
    const s = JSON.stringify(err.error != null ? err.error : err);
    if (s && s !== '{}' && s !== 'null') return s.slice(0, 800);
  } catch {
    /* ignore */
  }
  return 'Upload failed';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post(
  '/',
  (req, res, next) => {
    upload.single('file')(req, res, (multerErr) => {
      if (multerErr) {
        return res.status(400).json({ error: multerErr.message || 'File upload error' });
      }
      next();
    });
  },
  async (req, res) => {
    const companyId = req.body.companyId;
    const batchName = req.body.batchName;
    const defaultCampaignType = req.body.campaignType;
    const batchReward =
      req.body.reward !== undefined && req.body.reward !== null
        ? String(req.body.reward).trim()
        : '';

    if (!companyId || String(companyId).trim() === '') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'CSV file is required (field name: file)' });
    }

    let uploadRecordId = null;
    let step = 'createUploadsRow';
    try {
      uploadRecordId = await airtable.createUploadRecord(String(companyId).trim(), batchName, {
        reward: batchReward,
      });

      let attachmentError = null;
      step = 'attachCsvToAirtable';
      try {
        await airtable.attachCsvToUploadRecord(
          uploadRecordId,
          req.file.originalname || 'upload.csv',
          req.file.buffer
        );
      } catch (attErr) {
        attachmentError = errorMessage(attErr);
        console.error('[upload] Airtable Attachments field:', attErr);
      }

      step = 'parseCsv';
      const leads = await processCSV(req.file.buffer);
      let imported = 0;
      let skippedDnc = 0;

      const batchId = batchName ? String(batchName).trim() : uploadRecordId;

      for (const lead of leads) {
        const campaignType = defaultCampaignType
          ? String(defaultCampaignType).trim()
          : lead.campaignType;

        const onDnc = await airtable.checkDNC(lead.phone);
        if (onDnc) {
          skippedDnc++;
          continue;
        }

        step = 'createCustomerRow';
        const rowReward = lead.reward && String(lead.reward).trim() !== '' ? lead.reward : batchReward;
        await airtable.createCustomerRecord({
          name: lead.name,
          phone: lead.phone,
          campaignType: campaignType || 'review',
          companyId: String(companyId).trim(),
          batchId,
          reward: rowReward || undefined,
        });
        imported++;
      }

      step = 'markUploadDone';
      await airtable.updateUploadStatus(uploadRecordId, 'Done');

      return res.json({
        ok: true,
        uploadId: uploadRecordId,
        imported,
        skippedDnc,
        totalLeads: leads.length,
        attachmentError,
      });
    } catch (err) {
      console.error('[upload]', err);
      if (uploadRecordId) {
        try {
          await airtable.updateUploadStatus(uploadRecordId, 'Failed');
        } catch (e) {
          console.error('[upload] failed to mark upload Failed', e);
        }
      }
      return res.status(500).json({
        error: `[${step}] ${errorMessage(err)}`,
      });
    }
  }
);

module.exports = router;
