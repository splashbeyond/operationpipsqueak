import { useCallback, useEffect, useState } from 'react'
import { useCompany } from '../context/useCompany.js'
import { fetchCampaignTypes, getApiBase, uploadCsv } from '../api/client.js'

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
    }
  }, [])

  const onFileInput = (e) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setResult(null)
      setError('')
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

    const fd = new FormData()
    fd.append('file', file)
    fd.append('companyId', companyId.trim())
    if (batchName.trim()) fd.append('batchName', batchName.trim())
    if (reward.trim()) fd.append('reward', reward.trim())
    if (campaignType) fd.append('campaignType', campaignType)

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
                  <strong>{result.totalLeads}</strong> rows parsed from CSV
                </li>
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
