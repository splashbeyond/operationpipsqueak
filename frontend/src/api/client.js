export function getApiBase() {
  const raw = import.meta.env.VITE_API_URL
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    return String(raw).replace(/\/$/, '')
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }
  return ''
}

async function parseJsonSafe(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

export async function uploadCsv(formData) {
  const base = getApiBase()
  const res = await fetch(`${base}/upload`, {
    method: 'POST',
    body: formData,
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) {
    const msg = data?.error || data?.message || `Upload failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

/** Multipart: file, optional columnMapping (JSON string). */
export async function previewCsvUpload(formData) {
  const base = getApiBase()
  const res = await fetch(`${base}/upload/preview`, {
    method: 'POST',
    body: formData,
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) {
    const msg = data?.error || data?.message || `Preview failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

export async function fetchCampaignStats(companyId) {
  const base = getApiBase()
  const q = new URLSearchParams({ companyId })
  const res = await fetch(`${base}/campaigns/stats?${q}`)
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(data?.error || `Stats failed (${res.status})`)
  return data
}

export async function fetchCampaignLogs(companyId) {
  const base = getApiBase()
  const q = new URLSearchParams({ companyId })
  const res = await fetch(`${base}/campaigns?${q}`)
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(data?.error || `Campaigns failed (${res.status})`)
  return data
}

export async function fetchBatches(companyId) {
  const base = getApiBase()
  const q = new URLSearchParams({ companyId })
  const res = await fetch(`${base}/campaigns/batches?${q}`)
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(data?.error || `Batches failed (${res.status})`)
  return data
}

export async function fetchCampaignTypes(companyId) {
  const base = getApiBase()
  const q = new URLSearchParams({ companyId })
  const res = await fetch(`${base}/campaigns/campaign-types?${q}`)
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(data?.error || `Campaign types failed (${res.status})`)
  return data
}

export async function fetchCustomers(companyId, { status, batchId } = {}) {
  const base = getApiBase()
  const q = new URLSearchParams({ companyId })
  if (status) q.set('status', status)
  if (batchId) q.set('batchId', batchId)
  const res = await fetch(`${base}/campaigns/customers?${q}`)
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(data?.error || `Customers failed (${res.status})`)
  return data
}

export async function fetchSchedulerForecast(companyId, campaignType, startISO, endISO) {
  const base = getApiBase()
  const q = new URLSearchParams({ companyId, campaignType, start: startISO, end: endISO })
  const res = await fetch(`${base}/scheduler/forecast?${q}`)
  const data = await parseJsonSafe(res)
  if (!res.ok) throw new Error(data?.error || `Forecast failed (${res.status})`)
  return data
}
