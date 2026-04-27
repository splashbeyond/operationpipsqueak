import { useContext } from 'react'
import { CompanyContext } from './company-context.js'

export function useCompany() {
  const ctx = useContext(CompanyContext)
  if (!ctx) {
    throw new Error('useCompany must be used within CompanyProvider')
  }
  return ctx
}
