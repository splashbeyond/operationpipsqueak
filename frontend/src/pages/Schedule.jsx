import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '../context/useCompany.js'
import {
  fetchCampaignTypes,
  fetchSchedulerForecast,
  getApiBase,
} from '../api/client.js'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CAMPAIGN_COLORS = {
  review: 'bg-blue-100 text-blue-900 ring-1 ring-blue-200',
  no_show: 'bg-amber-100 text-amber-900 ring-1 ring-amber-200',
  cancellation: 'bg-rose-100 text-rose-900 ring-1 ring-rose-200',
  reactivation: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200',
  upsell: 'bg-violet-100 text-violet-900 ring-1 ring-violet-200',
  referral: 'bg-cyan-100 text-cyan-900 ring-1 ring-cyan-200',
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymd(year, monthZeroBased, day) {
  return `${year}-${String(monthZeroBased + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year, monthZeroBased) {
  return new Date(year, monthZeroBased + 1, 0).getDate()
}

function firstWeekdayOfMonth(year, monthZeroBased) {
  return new Date(year, monthZeroBased, 1).getDay()
}

function buildMonthGrid(year, monthZeroBased) {
  const rows = []
  const daysCount = daysInMonth(year, monthZeroBased)
  const lead = firstWeekdayOfMonth(year, monthZeroBased)
  let currentRow = []
  for (let i = 0; i < lead; i += 1) currentRow.push(null)
  for (let day = 1; day <= daysCount; day += 1) {
    currentRow.push(day)
    if (currentRow.length === 7) {
      rows.push(currentRow)
      currentRow = []
    }
  }
  if (currentRow.length) {
    while (currentRow.length < 7) currentRow.push(null)
    rows.push(currentRow)
  }
  return rows
}

function fmtSlotTime(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const hour12 = ((h + 11) % 12) + 1
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function Schedule() {
  const { companyId } = useCompany()
  const apiBase = getApiBase()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [campaignType, setCampaignType] = useState('')
  const [campaignOptions, setCampaignOptions] = useState([])
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(null)
  const [hoveredDate, setHoveredDate] = useState(null)

  // Load campaign options for this company.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!apiBase || !companyId.trim()) {
        setCampaignOptions([])
        return
      }
      try {
        const data = await fetchCampaignTypes(companyId.trim())
        if (cancelled) return
        const options = data?.campaigns || data?.campaignTypes || []
        setCampaignOptions(options)
        if (!campaignType && options.length) {
          setCampaignType(options[0].value || options[0])
        }
      } catch {
        // swallow — UI shows an empty selector with manual entry possible
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [apiBase, companyId, campaignType])

  // Fetch forecast for the visible month.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!apiBase || !companyId.trim() || !campaignType) {
        setForecast(null)
        return
      }
      const start = ymd(year, month, 1)
      const end = ymd(year, month, daysInMonth(year, month))
      setLoading(true)
      setError('')
      try {
        const data = await fetchSchedulerForecast(
          companyId.trim(),
          campaignType,
          start,
          end,
        )
        if (cancelled) return
        setForecast(data)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load forecast')
          setForecast(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [apiBase, companyId, campaignType, year, month])

  const dayMap = useMemo(() => {
    const map = new Map()
    if (!forecast?.days) return map
    for (const d of forecast.days) map.set(d.date, d)
    return map
  }, [forecast])

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])

  const totalScheduledThisMonth = useMemo(() => {
    if (!forecast?.days) return 0
    return forecast.days.reduce((s, d) => s + (d.target || 0), 0)
  }, [forecast])

  const selectedDay = selectedDate ? dayMap.get(selectedDate) : null
  const today = todayISO()

  function shiftMonth(delta) {
    let nextMonth = month + delta
    let nextYear = year
    while (nextMonth < 0) {
      nextMonth += 12
      nextYear -= 1
    }
    while (nextMonth > 11) {
      nextMonth -= 12
      nextYear += 1
    }
    setYear(nextYear)
    setMonth(nextMonth)
    setSelectedDate(null)
  }

  if (!apiBase) {
    return (
      <p className="text-sm text-piper-dark/70">Configure the API URL to load the schedule.</p>
    )
  }
  if (!companyId.trim()) {
    return <p className="text-sm text-piper-dark/70">Enter a Company ID in the header.</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-piper-dark">Schedule</h1>
          <p className="mt-1 text-sm text-piper-dark/70">
            Forecast of upcoming sends. Times shift slightly when contacts are uploaded or
            workers miss a tick — this view always reflects the current queue.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-piper-dark/80">Campaign</label>
            <select
              value={campaignType}
              onChange={(e) => {
                setCampaignType(e.target.value)
                setSelectedDate(null)
              }}
              className="rounded-[12px] border border-piper-dark/15 bg-white px-4 py-2 text-sm outline-none ring-piper-accent/30 focus:ring-2"
            >
              {campaignOptions.length === 0 ? (
                <option value="">No campaigns ready</option>
              ) : (
                campaignOptions.map((c) => {
                  const value = c.value || c
                  const label = c.label || c.value || c
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                })
              )}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-12)}
              className="rounded-full border border-piper-dark/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-piper-surface"
              title="Previous year"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-full border border-piper-dark/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-piper-surface"
              title="Previous month"
            >
              ‹
            </button>
            <span className="min-w-[10rem] text-center text-sm font-semibold text-piper-dark">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-full border border-piper-dark/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-piper-surface"
              title="Next month"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(12)}
              className="rounded-full border border-piper-dark/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-piper-surface"
              title="Next year"
            >
              »
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date()
                setYear(d.getFullYear())
                setMonth(d.getMonth())
                setSelectedDate(null)
              }}
              className="rounded-full border border-piper-dark/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-piper-surface"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile label="Timezone" value={forecast?.timezone || '—'} />
        <SummaryTile label="Queue size" value={forecast?.queueSize ?? '—'} />
        <SummaryTile label="Sent today" value={forecast?.sentToday ?? '—'} />
        <SummaryTile
          label={`Forecast ${MONTH_NAMES[month].slice(0, 3)}`}
          value={loading ? '…' : totalScheduledThisMonth}
        />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* ───── calendar grid ───── */}
        <div className="flex-1">
          <div className="overflow-hidden rounded-[12px] border border-piper-dark/10 bg-white shadow-sm">
            <div className="grid grid-cols-7 border-b border-piper-dark/10 bg-piper-surface/50 text-center text-[11px] font-semibold uppercase tracking-wide text-piper-dark/60">
              {WEEKDAY_HEADERS.map((d) => (
                <div key={d} className="px-2 py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.flat().map((day, idx) => {
                if (day == null) {
                  return (
                    <div
                      key={`blank-${idx}`}
                      className="min-h-[88px] border-b border-r border-piper-dark/5 bg-piper-bg/40"
                    />
                  )
                }
                const dateKey = ymd(year, month, day)
                const dayData = dayMap.get(dateKey)
                const isToday = dateKey === today
                const isSelected = dateKey === selectedDate
                const isHovered = dateKey === hoveredDate
                const closed = dayData?.isClosed
                const count = dayData?.target || 0
                const past = dayData && !closed && count === 0
                const isHoliday = dayData?.isHoliday

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => setSelectedDate(dateKey)}
                    onMouseEnter={() => setHoveredDate(dateKey)}
                    onMouseLeave={() => setHoveredDate((h) => (h === dateKey ? null : h))}
                    className={[
                      'group relative min-h-[88px] border-b border-r border-piper-dark/5 px-2 py-2 text-left transition-colors',
                      closed ? 'bg-piper-bg/30' : 'bg-white hover:bg-piper-bg/30',
                      isSelected ? 'ring-2 ring-piper-accent/60 ring-inset' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={[
                          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                          isToday
                            ? 'bg-piper-primary text-white'
                            : 'text-piper-dark',
                        ].join(' ')}
                      >
                        {day}
                      </span>
                      {closed ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-piper-dark/40">
                          {isHoliday ? 'Holiday' : 'Closed'}
                        </span>
                      ) : count > 0 ? (
                        <span
                          className={[
                            'rounded-full px-2 py-0.5 text-xs font-semibold',
                            CAMPAIGN_COLORS[campaignType] ||
                              'bg-piper-surface text-piper-dark',
                          ].join(' ')}
                        >
                          {count}
                        </span>
                      ) : past ? (
                        <span className="text-[10px] uppercase tracking-wide text-piper-dark/30">
                          Past
                        </span>
                      ) : null}
                    </div>

                    {/* hover popover with first few names */}
                    {isHovered && dayData && dayData.slots?.length > 0 ? (
                      <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-[12px] border border-piper-dark/10 bg-white p-3 text-xs shadow-lg">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-semibold text-piper-dark">
                            {dayData.dayOfWeek} · {dayData.window?.open}–{dayData.window?.close}
                          </span>
                          <span className="text-piper-dark/60">
                            {dayData.target} send{dayData.target === 1 ? '' : 's'}
                          </span>
                        </div>
                        <ul className="space-y-1">
                          {dayData.slots.slice(0, 5).map((s) => (
                            <li
                              key={s.customerId}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="truncate text-piper-dark/80">{s.contactName}</span>
                              <span className="shrink-0 font-medium text-piper-dark">
                                {fmtSlotTime(s.scheduledLocal)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {dayData.slots.length > 5 ? (
                          <p className="mt-2 text-[10px] text-piper-dark/50">
                            + {dayData.slots.length - 5} more — click for full list
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
          <p className="mt-3 text-xs text-piper-dark/50">
            Numbers show projected sends per day. Hover for a quick preview, click for the full
            day. Holidays and out-of-window days are skipped automatically.
          </p>
        </div>

        {/* ───── sidebar ───── */}
        <aside className="w-full lg:w-96">
          <div className="rounded-[12px] border border-piper-dark/10 bg-white p-5 shadow-sm">
            {selectedDay ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-piper-dark">
                      {selectedDay.dayOfWeek}, {selectedDate}
                    </h2>
                    <p className="text-xs text-piper-dark/60">
                      {selectedDay.isClosed
                        ? selectedDay.isHoliday
                          ? 'Holiday — no sends'
                          : 'Closed — no sends'
                        : `${selectedDay.window?.open}–${selectedDay.window?.close} ${forecast?.timezone || ''}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="rounded-full border border-piper-dark/15 px-2 py-1 text-xs text-piper-dark/70 hover:bg-piper-surface"
                  >
                    Close
                  </button>
                </div>

                {selectedDay.isClosed ? (
                  <p className="text-sm text-piper-dark/60">
                    No sends scheduled. {selectedDay.isHoliday
                      ? 'This date is on the major-holiday list.'
                      : 'No send window for this day of the week.'}
                  </p>
                ) : selectedDay.slots.length === 0 ? (
                  <p className="text-sm text-piper-dark/60">
                    Nothing scheduled. {forecast?.queueSize === 0
                      ? 'The Awaiting queue is empty.'
                      : 'Earlier days in the forecast already drained the queue.'}
                  </p>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between text-xs text-piper-dark/60">
                      <span>
                        {selectedDay.target} send{selectedDay.target === 1 ? '' : 's'}
                      </span>
                      <span>{selectedDay.remainingQueueAfter} left in queue after</span>
                    </div>
                    <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                      {selectedDay.slots.map((s) => (
                        <li
                          key={s.customerId}
                          className="rounded-[10px] border border-piper-dark/10 bg-piper-surface/40 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-piper-dark">
                                {s.contactName}
                              </p>
                              <p className="text-xs text-piper-dark/60">
                                ··· {s.phoneLast4 || '----'}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-semibold text-piper-dark">
                                {fmtSlotTime(s.scheduledLocal)}
                              </p>
                              <span
                                className={[
                                  'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                  CAMPAIGN_COLORS[campaignType] ||
                                    'bg-piper-surface text-piper-dark',
                                ].join(' ')}
                              >
                                {campaignType}
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <div className="text-sm text-piper-dark/60">
                <p className="font-medium text-piper-dark">Click a day</p>
                <p className="mt-1">
                  Pick a date on the calendar to see who is scheduled to receive a text and at
                  what time.
                </p>
                <div className="mt-4 space-y-2 text-xs">
                  <p>
                    <strong>Forecast vs reality:</strong> times are projected from the current
                    queue and rules. The actual moment a text fires can shift by a few minutes
                    (jitter) and the queue assignment changes when new contacts upload.
                  </p>
                  <p>
                    <strong>Past days</strong> are not projected — see Campaigns for what
                    actually shipped.
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function SummaryTile({ label, value }) {
  return (
    <div className="rounded-[12px] border border-piper-dark/10 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-piper-dark/50">{label}</p>
      <p className="mt-2 text-xl font-semibold text-piper-dark">{value}</p>
    </div>
  )
}
