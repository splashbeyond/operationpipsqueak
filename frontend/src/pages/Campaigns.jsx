import { useEffect, useMemo, useRef, useState } from 'react'
import { useCompany } from '../context/useCompany.js'
import {
  fetchCampaignLogs,
  fetchCampaignStats,
  fetchCompanyTemplates,
  getApiBase,
  saveCompanyTemplate,
} from '../api/client.js'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'Sent', label: 'Sent' },
  { value: 'Replied', label: 'Replied' },
  { value: 'Payload Sent', label: 'Payload sent' },
  { value: 'Failed', label: 'Failed' },
]

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

export function Campaigns() {
  const { companyId } = useCompany()
  const apiBase = getApiBase()
  const [stats, setStats] = useState(null)
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!apiBase || !companyId.trim()) {
        setStats(null)
        setLogs([])
        return
      }
      setLoading(true)
      setError('')
      try {
        const [s, l] = await Promise.all([
          fetchCampaignStats(companyId.trim()),
          fetchCampaignLogs(companyId.trim()),
        ])
        if (cancelled) return
        setStats(s)
        setLogs(l.logs || [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [apiBase, companyId])

  const filtered = useMemo(() => {
    if (!status) return logs
    return logs.filter((row) => row.status === status)
  }, [logs, status])

  const replyPct = stats?.replyRate != null ? Math.round(stats.replyRate * 1000) / 10 : 0

  if (!apiBase) {
    return <p className="text-sm text-piper-dark/70">Configure the API URL to load campaigns.</p>
  }
  if (!companyId.trim()) {
    return <p className="text-sm text-piper-dark/70">Enter a Company ID in the header.</p>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-piper-dark">Campaigns</h1>
        <p className="mt-1 text-sm text-piper-dark/70">Logs, stats, and message templates for this company.</p>
      </div>

      {error ? (
        <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total sent" value={stats?.totalSent ?? '—'} loading={loading} />
        <StatCard label="Total replied" value={stats?.totalReplied ?? '—'} loading={loading} />
        <StatCard
          label="Reply rate"
          value={stats ? `${replyPct}%` : '—'}
          loading={loading}
        />
        <StatCard label="Failed" value={stats?.totalFailed ?? '—'} loading={loading} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-piper-dark/80">Filter by status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="max-w-xs rounded-[12px] border border-piper-dark/15 bg-white px-4 py-2 text-sm outline-none ring-piper-accent/30 focus:ring-2"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {loading ? <span className="text-sm text-piper-dark/50">Loading…</span> : null}
      </div>

      <div className="overflow-hidden rounded-[12px] border border-piper-dark/10 bg-piper-surface/40 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-piper-surface/80 text-xs font-semibold uppercase tracking-wide text-piper-dark/60">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-piper-dark/10 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-piper-dark/50">
                    No rows match this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-piper-bg/40">
                    <td className="px-4 py-3 text-piper-dark/50">—</td>
                    <td className="px-4 py-3 font-medium">{row.phone || '—'}</td>
                    <td className="px-4 py-3">{row.campaignType || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-piper-surface px-2 py-0.5 text-xs font-medium">
                        {row.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-piper-dark/70">{formatWhen(row.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TemplatesSection companyId={companyId.trim()} />
    </div>
  )
}

function StatCard({ label, value, loading }) {
  return (
    <div className="rounded-[12px] border border-piper-dark/10 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-piper-dark/50">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-piper-dark">
        {loading && value === '—' ? '…' : value}
      </p>
    </div>
  )
}

/* ───────────────────────── Templates section ───────────────────────── */

function TemplatesSection({ companyId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!companyId) {
        setData(null)
        return
      }
      setLoading(true)
      setError('')
      try {
        const res = await fetchCompanyTemplates(companyId)
        if (!cancelled) setData(res)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load templates')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const grouped = useMemo(() => {
    const out = { handshake: [], payload: [] }
    if (!data?.items) return out
    for (const t of data.items) {
      if (t.kind === 'handshake') out.handshake.push(t)
      else if (t.kind === 'payload') out.payload.push(t)
    }
    return out
  }, [data])

  function applySaved(key, savedValue) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.key === key ? { ...it, value: savedValue } : it
        ),
      }
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-piper-dark">Templates</h2>
          <p className="text-sm text-piper-dark/70">
            Edit the SMS templates this business uses for each campaign. Changes write directly
            to the matching Company Info field in Airtable.
          </p>
        </div>
        {loading ? <span className="text-sm text-piper-dark/50">Loading…</span> : null}
      </div>

      <div className="rounded-[12px] border border-piper-dark/10 bg-piper-surface/40 p-3 text-xs text-piper-dark/70">
        <span className="font-semibold">Available placeholders:</span>{' '}
        {(data?.placeholders || []).map((p) => (
          <code key={p} className="mr-2 rounded bg-white px-1.5 py-0.5 text-piper-dark">
            {p}
          </code>
        ))}
      </div>

      {error ? (
        <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      <TemplateGroup
        title="Handshake"
        subtitle="The first SMS sent to a new contact for each campaign."
        items={grouped.handshake}
        companyId={companyId}
        onSaved={applySaved}
      />

      <TemplateGroup
        title="Payload"
        subtitle="The follow-up SMS sent after an affirmative reply (YES). Booking is shared by No-Show, Cancellation, and Reactivation."
        items={grouped.payload}
        companyId={companyId}
        onSaved={applySaved}
      />
    </section>
  )
}

function TemplateGroup({ title, subtitle, items, companyId, onSaved }) {
  if (!items?.length) return null

  // Group rows into pairs where the same campaign has both reward + no-reward
  const pairs = []
  const seen = new Map()
  for (const it of items) {
    if (!seen.has(it.campaign)) {
      seen.set(it.campaign, { campaign: it.campaign, reward: null, noReward: null })
      pairs.push(seen.get(it.campaign))
    }
    const p = seen.get(it.campaign)
    if (it.variant === 'reward') p.reward = it
    else if (it.variant === 'noReward') p.noReward = it
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-piper-dark">{title}</h3>
        <p className="text-xs text-piper-dark/60">{subtitle}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {pairs.map((pair) => (
          <CampaignTemplateCard
            key={`${title}-${pair.campaign}`}
            title={prettyCampaignTitle(pair.campaign)}
            kind={title.toLowerCase()}
            campaign={pair.campaign}
            reward={pair.reward}
            noReward={pair.noReward}
            companyId={companyId}
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  )
}

function prettyCampaignTitle(campaign) {
  switch (campaign) {
    case 'review': return 'Review'
    case 'no_show': return 'No-Show'
    case 'cancellation': return 'Cancellation'
    case 'reactivation': return 'Reactivation'
    case 'referral': return 'Referral'
    case 'upsell': return 'Upsell'
    case 'booking': return 'Booking · No-Show / Cancellation / Reactivation'
    default: return campaign
  }
}

function CampaignTemplateCard({ title, kind, campaign, reward, noReward, companyId, onSaved }) {
  return (
    <div className="rounded-[12px] border border-piper-dark/10 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-piper-dark">{title}</h4>
      </div>
      <div className="space-y-3">
        {reward ? (
          <TemplateRow
            label="With reward"
            item={reward}
            kind={kind}
            campaign={campaign}
            companyId={companyId}
            onSaved={onSaved}
          />
        ) : null}
        {noReward ? (
          <TemplateRow
            label="No reward"
            item={noReward}
            kind={kind}
            campaign={campaign}
            companyId={companyId}
            onSaved={onSaved}
          />
        ) : null}
      </div>
    </div>
  )
}

function TemplateRow({ label, item, kind, campaign, companyId, onSaved }) {
  const [draft, setDraft] = useState(item.value || '')
  const [savedValue, setSavedValue] = useState(item.value || '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [err, setErr] = useState('')
  const initialized = useRef(false)

  // Re-sync from server when the underlying item changes (e.g., switching companies).
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      return
    }
    setDraft(item.value || '')
    setSavedValue(item.value || '')
  }, [item.value])

  const dirty = draft !== savedValue

  async function handleSave() {
    setSaving(true)
    setErr('')
    try {
      await saveCompanyTemplate(companyId, {
        kind,
        campaign,
        variant: item.variant,
        value: draft,
      })
      setSavedValue(draft)
      setSavedAt(Date.now())
      onSaved?.(item.key, draft)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleRevert() {
    setDraft(savedValue)
    setErr('')
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-piper-dark/70">{label}</span>
        <div className="flex items-center gap-2">
          {err ? (
            <span className="text-xs text-red-700">{err}</span>
          ) : savedAt && Date.now() - savedAt < 4000 ? (
            <span className="text-xs text-emerald-700">Saved</span>
          ) : null}
          {dirty ? (
            <button
              type="button"
              onClick={handleRevert}
              disabled={saving}
              className="rounded-full border border-piper-dark/15 px-3 py-1 text-xs font-medium text-piper-dark/70 hover:bg-piper-surface disabled:opacity-50"
            >
              Revert
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              dirty && !saving
                ? 'bg-piper-primary text-white hover:bg-piper-primary/90'
                : 'bg-piper-surface text-piper-dark/40 cursor-not-allowed',
            ].join(' ')}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        spellCheck
        placeholder="Enter SMS template…"
        className="block w-full resize-y rounded-[10px] border border-piper-dark/15 bg-white px-3 py-2 text-sm leading-snug text-piper-text outline-none ring-piper-accent/30 focus:ring-2"
      />
      <p className="mt-1 text-[10px] text-piper-dark/40">
        Field aliases: {item.aliases?.join(' / ')}
      </p>
    </div>
  )
}
