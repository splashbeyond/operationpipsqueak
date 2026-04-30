import { useCallback, useEffect, useState } from 'react'
import { useCompany } from '../context/useCompany.js'
import { fetchCampaignTypes, getApiBase, previewCsvUpload, uploadCsv } from '../api/client.js'

/** @param {{ phone: string, name: string, campaign_type: string, reward: string }} m */
function columnMappingToJson(m) {
  return JSON.stringify({
    phone: m.phone || null,
    name: m.name?.trim() ? m.name : null,
    campaign_type: m.campaign_type?.trim() ? m.campaign_type : null,
    reward: m.reward?.trim() ? m.reward : null,
  })
}

/** Shown while loading or if API fails — values must stay in sync with backend `CANONICAL_CAMPAIGNS`. */
const FALLBACK_CAMPAIGN_OPTIONS = [
  { value: 'review', label: 'Review' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'upsell', label: 'Membership / upsell' },
  { value: 'referral', label: 'Referral' },
]

export function Upload() {
  const { companyId } = useCompany()
  const apiBase = getApiBase()
  const [batchName, setBatchName] = useState('')
  const [reward, setReward] = useState('')
  const [campaignType, setCampaignType] = useState('')
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [previewData, setPreviewData] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [columnMapping, setColumnMapping] = useState(null)
  const [campaignMeta, setCampaignMeta] = useState(null)
  const [campaignMetaLoading, setCampaignMetaLoading] = useState(false)
  const [campaignMetaError, setCampaignMetaError] = useState('')

  useEffect(() => {
    const id = companyId?.trim()
    if (!id || !apiBase) {
      setCampaignMeta(null)
      setCampaignMetaError('')
      return
    }
    let cancelled = false
    setCampaignMetaLoading(true)
    setCampaignMetaError('')
    fetchCampaignTypes(id)
      .then((data) => {
        if (!cancelled) setCampaignMeta(data)
      })
      .catch((e) => {
        if (!cancelled) {
          setCampaignMeta(null)
          setCampaignMetaError(e instanceof Error ? e.message : 'Could not load Company Info campaigns')
        }
      })
      .finally(() => {
        if (!cancelled) setCampaignMetaLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, apiBase])

  const campaignSelectOptions =
    campaignMeta?.readyForUpload?.length > 0
      ? campaignMeta.readyForUpload
      : null

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setFile(f)
      setResult(null)
      setError('')
      setPreviewData(null)
      setPreviewError('')
      setColumnMapping(null)
    }
  }, [])

  const onFileInput = (e) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setResult(null)
      setError('')
      setPreviewData(null)
      setPreviewError('')
      setColumnMapping(null)
    }
  }

  useEffect(() => {
    if (!file || !apiBase) {
      setPreviewData(null)
      setColumnMapping(null)
      setPreviewError('')
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError('')
    const fd = new FormData()
    fd.append('file', file)
    previewCsvUpload(fd)
      .then((data) => {
        if (cancelled) return
        setPreviewData(data)
        const sm = data.suggestedMapping || {}
        setColumnMapping({
          phone: sm.phone || '',
          name: sm.name || '',
          campaign_type: sm.campaign_type || '',
          reward: sm.reward || '',
        })
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewData(null)
          setColumnMapping(null)
          setPreviewError(e instanceof Error ? e.message : 'Preview failed')
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file, apiBase])

  const refreshPreviewWithMapping = async () => {
    if (!file || !apiBase || !columnMapping?.phone) return
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('columnMapping', columnMappingToJson(columnMapping))
      const data = await previewCsvUpload(fd)
      setPreviewData(data)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setResult(null)
    if (!apiBase) {
      setError('API URL is not configured.')
      return
    }
    if (!companyId.trim()) {
      setError('Enter a Company ID in the header.')
      return
    }
    if (!file) {
      setError('Choose a CSV file.')
      return
    }
    if (previewData && columnMapping && !columnMapping.phone) {
      setError('Choose which CSV column is the phone number before importing.')
      return
    }

    const fd = new FormData()
    fd.append('file', file)
    fd.append('companyId', companyId.trim())
    if (batchName.trim()) fd.append('batchName', batchName.trim())
    if (reward.trim()) fd.append('reward', reward.trim())
    if (campaignType) fd.append('campaignType', campaignType)
    if (previewData && columnMapping?.phone) {
      fd.append('columnMapping', columnMappingToJson(columnMapping))
    }

    setLoading(true)
    try {
      const data = await uploadCsv(fd)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-piper-dark">Upload CSV</h1>
        <p className="mt-1 text-sm text-piper-dark/70">
          Import leads into Airtable. DNC numbers are skipped automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={[
            'flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-6 py-10 transition-colors',
            dragOver
              ? 'border-piper-accent bg-piper-accent/10'
              : 'border-piper-dark/20 bg-piper-surface/60 hover:border-piper-primary/50',
          ].join(' ')}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            id="csv-file"
            onChange={onFileInput}
          />
          <label htmlFor="csv-file" className="cursor-pointer text-center">
            <span className="text-lg font-medium text-piper-dark">Drop CSV here</span>
            <span className="mt-2 block text-sm text-piper-dark/60">or click to browse</span>
            {file ? (
              <span className="mt-4 block text-sm font-medium text-piper-accent">{file.name}</span>
            ) : null}
          </label>
        </div>

        {previewLoading && file ? (
          <p className="text-sm text-piper-dark/60">Analyzing CSV columns…</p>
        ) : null}
        {previewError ? (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Preview unavailable — import will use automatic column detection only. ({previewError})
          </div>
        ) : null}

        {previewData?.headers?.length && columnMapping ? (
          <div className="space-y-4 rounded-[12px] border border-piper-dark/10 bg-white/90 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-piper-dark">Column mapping</h2>
              <p className="mt-1 text-xs text-piper-dark/55">
                We guessed columns from your headers (and OpenAI when configured). Adjust if needed,
                then <strong>Update preview</strong> to check normalized phones and names.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-piper-dark/80">
                  Phone <span className="text-red-600">*</span>
                </span>
                <select
                  value={columnMapping.phone}
                  onChange={(e) =>
                    setColumnMapping((m) => (m ? { ...m, phone: e.target.value } : m))
                  }
                  className="rounded-[12px] border border-piper-dark/15 bg-white px-3 py-2.5 text-sm outline-none ring-piper-accent/30 focus:ring-2"
                  required
                >
                  <option value="">— Select column —</option>
                  {previewData.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-piper-dark/80">Name (first word used)</span>
                <select
                  value={columnMapping.name}
                  onChange={(e) =>
                    setColumnMapping((m) => (m ? { ...m, name: e.target.value } : m))
                  }
                  className="rounded-[12px] border border-piper-dark/15 bg-white px-3 py-2.5 text-sm outline-none ring-piper-accent/30 focus:ring-2"
                >
                  <option value="">— None —</option>
                  {previewData.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-piper-dark/80">Campaign (CSV column)</span>
                <select
                  value={columnMapping.campaign_type}
                  onChange={(e) =>
                    setColumnMapping((m) => (m ? { ...m, campaign_type: e.target.value } : m))
                  }
                  className="rounded-[12px] border border-piper-dark/15 bg-white px-3 py-2.5 text-sm outline-none ring-piper-accent/30 focus:ring-2"
                >
                  <option value="">— None (use form / default) —</option>
                  {previewData.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-piper-dark/80">Reward (CSV column)</span>
                <select
                  value={columnMapping.reward}
                  onChange={(e) =>
                    setColumnMapping((m) => (m ? { ...m, reward: e.target.value } : m))
                  }
                  className="rounded-[12px] border border-piper-dark/15 bg-white px-3 py-2.5 text-sm outline-none ring-piper-accent/30 focus:ring-2"
                >
                  <option value="">— None —</option>
                  {previewData.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void refreshPreviewWithMapping()}
                disabled={!columnMapping.phone || previewLoading}
                className="rounded-full border border-piper-dark/20 bg-white px-4 py-2 text-sm font-medium text-piper-dark hover:bg-piper-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                Update preview
              </button>
              {previewData.previewSample ? (
                <span className="text-xs text-piper-dark/55">
                  Sample: {previewData.previewSample.validPhonesInSample} valid US phones /{' '}
                  {previewData.previewSample.nonEmptyPhoneCellsInSample} filled cells (first{' '}
                  {previewData.previewSample.rowsInSample} rows)
                </span>
              ) : null}
            </div>
            {previewData.previewLeads?.length ? (
              <div className="overflow-x-auto rounded-[12px] border border-piper-dark/10">
                <table className="min-w-full text-left text-xs text-piper-dark">
                  <thead className="bg-piper-surface/80 text-piper-dark/70">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Phone (E.164)</th>
                      <th className="px-3 py-2 font-medium">Campaign</th>
                      <th className="px-3 py-2 font-medium">Reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.previewLeads.map((row, i) => (
                      <tr key={i} className="border-t border-piper-dark/10">
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2 font-mono">{row.phone}</td>
                        <td className="px-3 py-2">{row.campaignType}</td>
                        <td className="px-3 py-2">{row.reward || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-amber-900">
                No valid US phone numbers in the preview rows for this mapping. Fix the Phone column
                or format (+1 ten digits).
              </p>
            )}
            <p className="text-xs text-piper-dark/50">
              Full file: <strong>{previewData.dataRowCount}</strong> data rows.
            </p>
          </div>
        ) : null}

        <div className="space-y-4 rounded-[12px] border border-piper-dark/10 bg-white/80 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="campaign-type" className="text-xs font-medium text-piper-dark/80">
              Campaign type
              {campaignMetaLoading ? (
                <span className="ml-2 font-normal text-piper-dark/45">(loading Company Info…)</span>
              ) : null}
            </label>
            <select
              id="campaign-type"
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value)}
              className="rounded-[12px] border border-piper-dark/15 bg-white px-4 py-3 text-sm outline-none ring-piper-accent/30 focus:ring-2"
            >
              <option value="">From CSV column (or Review if missing)</option>
              {campaignSelectOptions
                ? campaignSelectOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                      {!c.hasPayload ? ' — payload not set (Yes-reply SMS)' : ''}
                    </option>
                  ))
                : FALLBACK_CAMPAIGN_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
            </select>
            <p className="text-xs leading-relaxed text-piper-dark/55">
              When a campaign is selected here, Piper uses that row’s <strong>Company Info</strong>{' '}
              handshake template for the first text and the matching payload after the customer replies
              Yes. The list above is built from your Company ID in the header (templates that already
              have handshake text).
            </p>
            {campaignMeta &&
            campaignMeta.readyForUpload &&
            campaignMeta.readyForUpload.length === 0 ? (
              <p className="text-xs font-medium text-amber-900">
                No handshake templates found for this company in Airtable. Add{' '}
                <strong>Handshake Matrix</strong> or campaign templates (e.g. Review Template) on the
                Company Info row, or leave this as “From CSV…”.
              </p>
            ) : null}
            {campaignMetaError ? (
              <p className="text-xs text-amber-900">
                Could not sync with API ({campaignMetaError}). Using generic campaign list — handshake
                still comes from Company Info when you send.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="batch-name" className="text-xs font-medium text-piper-dark/80">
                Batch name <span className="font-normal text-piper-dark/50">(optional)</span>
              </label>
              <input
                id="batch-name"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                className="rounded-[12px] border border-piper-dark/15 bg-white px-4 py-3 text-sm outline-none ring-piper-accent/30 focus:ring-2"
                placeholder="February follow-ups"
              />
              <p className="text-xs text-piper-dark/50">
                If your Airtable <strong>Uploads → Batch ID</strong> field is not plain text, set{' '}
                <code className="rounded bg-piper-dark/5 px-1">AIRTABLE_UPLOAD_OMIT_BATCH_ID=1</code> in{' '}
                <code className="rounded bg-piper-dark/5 px-1">.env</code> or leave batch name empty.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="reward" className="text-xs font-medium text-piper-dark/80">
              Reward <span className="font-normal text-piper-dark/50">(optional)</span>
            </label>
            <textarea
              id="reward"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              rows={3}
              className="rounded-[12px] border border-piper-dark/15 bg-white px-4 py-3 text-sm outline-none ring-piper-accent/30 focus:ring-2"
              placeholder="Type the incentive for this batch (e.g. $10 credit, free drink, entry into a drawing)…"
            />
            <p className="text-xs leading-relaxed text-piper-dark/55">
              Saved on each imported lead in Airtable (<strong>Customer Data → Reward</strong>). Use the{' '}
              <code className="rounded bg-piper-dark/5 px-1">[Reward]</code> token in your Company Info
              templates. A <strong>Reward</strong> column in the CSV overrides this for that row only.
            </p>
          </div>
        </div>

        {error ? (
          <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="space-y-3">
            <div className="rounded-[12px] border border-piper-accent/30 bg-white px-4 py-4 text-sm shadow-sm">
              <p className="font-semibold text-piper-dark">Import complete</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-piper-dark/80">
                <li>
                  <strong>{result.imported}</strong> leads imported
                </li>
                <li>
                  <strong>{result.skippedDnc}</strong> skipped (DNC)
                </li>
                <li>
                  <strong>{result.skippedDuplicate ?? 0}</strong> skipped (duplicate phone + campaign in
                  CSV)
                </li>
                <li>
                  <strong>{result.totalLeads}</strong> data rows in CSV
                </li>
                {result.validPhoneLeads != null && result.validPhoneLeads !== result.totalLeads ? (
                  <li>
                    <strong>{result.validPhoneLeads}</strong> rows with a valid phone (imported +
                    skipped)
                  </li>
                ) : null}
                {result.uploadId ? (
                  <li>
                    Upload record: <code className="text-xs">{result.uploadId}</code>
                  </li>
                ) : null}
                {result.attachmentError ? (
                  <li className="list-none text-amber-900">
                    CSV was <strong>not</strong> attached in Airtable: {result.attachmentError}
                  </li>
                ) : (
                  <li className="list-none text-piper-accent">
                    CSV file attached to the Uploads row in Airtable.
                  </li>
                )}
              </ul>
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !apiBase}
          className="w-full rounded-full bg-piper-primary px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-piper-dark disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {loading ? 'Uploading…' : 'Upload & import'}
        </button>
      </form>
    </div>
  )
}
