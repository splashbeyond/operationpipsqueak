import { NavLink, Outlet } from 'react-router-dom'
import { useCompany } from '../context/useCompany.js'
import { getApiBase } from '../api/client.js'

const navClass = ({ isActive }) =>
  [
    'rounded-full px-4 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-piper-primary text-white'
      : 'text-piper-text hover:bg-piper-surface/80',
  ].join(' ')

export function Layout() {
  const { companyId, setCompanyId } = useCompany()
  const apiBase = getApiBase()

  return (
    <div className="min-h-screen bg-piper-bg text-piper-text">
      <header className="border-b border-piper-dark/10 bg-piper-surface/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6">
            <NavLink to="/upload" className="text-2xl font-semibold tracking-tight">
              <span className="text-piper-primary lowercase">p</span>
              <span className="text-piper-dark">iper</span>
            </NavLink>
            <nav className="flex flex-wrap gap-2">
              <NavLink to="/upload" className={navClass}>
                Upload
              </NavLink>
              <NavLink to="/campaigns" className={navClass}>
                Campaigns
              </NavLink>
              <NavLink to="/batches" className={navClass}>
                Batches
              </NavLink>
            </nav>
          </div>
          <div className="flex w-full flex-col gap-1 sm:w-72">
            <label htmlFor="companyId" className="text-xs font-medium text-piper-dark/80">
              Company ID
            </label>
            <input
              id="companyId"
              type="text"
              autoComplete="off"
              placeholder="e.g. BUS-1"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="rounded-full border border-piper-dark/15 bg-white px-4 py-2 text-sm text-piper-text outline-none ring-piper-accent/40 placeholder:text-piper-dark/35 focus:ring-2"
            />
          </div>
        </div>
        {!apiBase ? (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950">
            Set <code className="rounded bg-amber-100 px-1">VITE_API_URL</code> in{' '}
            <code className="rounded bg-amber-100 px-1">frontend/.env</code> (e.g.{' '}
            <code className="rounded bg-amber-100 px-1">http://localhost:3000</code>).
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
