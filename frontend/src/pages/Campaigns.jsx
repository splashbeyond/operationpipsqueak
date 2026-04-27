import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '../context/useCompany.js'
import { fetchCampaignLogs, fetchCampaignStats, getApiBase } from '../api/client.js'

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
        <p className="mt-1 text-sm text-piper-dark/70">Logs and reply stats for this company.</p>
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
