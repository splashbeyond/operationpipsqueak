import { useMemo, useState } from 'react'
import { CompanyContext } from './company-context.js'

const STORAGE_KEY = 'piper_company_id'

export function CompanyProvider({ children }) {
  const [companyId, setCompanyIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })

  const setCompanyId = (value) => {
    const v = String(value ?? '')
    setCompanyIdState(v)
    try {
      if (v) localStorage.setItem(STORAGE_KEY, v)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  const value = useMemo(() => ({ companyId, setCompanyId }), [companyId])

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}
