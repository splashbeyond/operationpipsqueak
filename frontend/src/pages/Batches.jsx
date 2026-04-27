import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '../context/useCompany.js'
import { fetchBatches, fetchCustomers, getApiBase } from '../api/client.js'

function batchMatchKey(batch) {
  return batch.batchId || batch.id
}

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

export function Batches() {
  const { companyId } = useCompany()
  const apiBase = getApiBase()
  const [batches, setBatches] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [detail, setDetail] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!apiBase || !companyId.trim()) {
        setBatches([])
        setCustomers([])
        return
      }
      setLoading(true)
      setError('')
      try {
        const [b, c] = await Promise.all([
          fetchBatches(companyId.trim()),
          fetchCustomers(companyId.trim()),
        ])
        if (cancelled) return
        setBatches(b.batches || [])
        setCustomers(c.customers || [])
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

  const counts = useMemo(() => {
    const map = new Map()
    for (const c of customers) {
      const k = c.batchId
      if (!k) continue
      map.set(k, (map.get(k) || 0) + 1)
    }
    return map
  }, [customers])

  const toggleBatch = async (batch) => {
    const id = batch.id
    if (expandedId === id) {
      setExpandedId(null)
      setDetail([])
      return
    }
    setExpandedId(id)
    setDetail([])
    const key = batchMatchKey(batch)
    if (!apiBase || !companyId.trim() || !key) return
    setDetailLoading(true)
    try {
      const res = await fetchCustomers(companyId.trim(), { batchId: String(key) })
      setDetail(res.customers || [])
    } catch (e) {
      setDetail([])
      setError(e instanceof Error ? e.message : 'Failed to load batch customers')
    } finally {
      setDetailLoading(false)
    }
  }

  if (!apiBase) {
    return <p className="text-sm text-piper-dark/70">Configure the API URL to load batches.</p>
  }
  if (!companyId.trim()) {
    return <p className="text-sm text-piper-dark/70">Enter a Company ID in the header.</p>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-piper-dark">Batches</h1>
        <p className="mt-1 text-sm text-piper-dark/70">
          Upload history and leads per batch (counts from Customer Data).
        </p>
      </div>

      {error ? (
        <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-piper-dark/50">Loading…</p> : null}

      <div className="space-y-3">
        {batches.length === 0 && !loading ? (
          <p className="text-sm text-piper-dark/50">No upload batches yet.</p>
        ) : null}
        {batches.map((batch) => {
          const key = batchMatchKey(batch)
          const leadCount =
            key != null && key !== ''
              ? counts.get(String(key)) ?? counts.get(batch.id) ?? 0
              : counts.get(batch.id) ?? 0
          const open = expandedId === batch.id
          return (
            <div
              key={batch.id}
              className="overflow-hidden rounded-[12px] border border-piper-dark/10 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() => void toggleBatch(batch)}
                className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-piper-bg/30"
              >
                <div>
                  <p className="font-medium text-piper-dark">
                    {batch.batchId ? String(batch.batchId) : `Upload ${batch.id.slice(0, 8)}…`}
                  </p>
                  <p className="text-xs text-piper-dark/50">{formatWhen(batch.createdAt)}</p>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-piper-dark/70">
                    <strong className="text-piper-dark">{leadCount}</strong> leads
                  </span>
                  <span className="rounded-full bg-piper-surface px-3 py-1 text-xs font-medium">
                    {batch.status || '—'}
                  </span>
                  <span className="text-piper-dark/40">{open ? '▲' : '▼'}</span>
                </div>
              </button>
              {open ? (
                <div className="border-t border-piper-dark/10 bg-piper-surface/30 px-4 py-4">
                  {detailLoading ? (
                    <p className="text-sm text-piper-dark/50">Loading customers…</p>
                  ) : detail.length === 0 ? (
                    <p className="text-sm text-piper-dark/50">No customer rows for this batch key.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-[12px] border border-piper-dark/10 bg-white">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-piper-surface/80 text-xs font-semibold uppercase tracking-wide text-piper-dark/60">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Phone</th>
                            <th className="px-3 py-2">Campaign</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-piper-dark/10">
                          {detail.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-2">{r.name || '—'}</td>
                              <td className="px-3 py-2">{r.phone || '—'}</td>
                              <td className="px-3 py-2">{r.campaignType || '—'}</td>
                              <td className="px-3 py-2">{r.status || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
