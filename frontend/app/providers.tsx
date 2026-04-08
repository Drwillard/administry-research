'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AgencyCtx {
  agencyId: string
  setAgencyId: (id: string) => void
}

const AgencyContext = createContext<AgencyCtx>({ agencyId: '', setAgencyId: () => {} })

export function Providers({ children }: { children: ReactNode }) {
  const [agencyId, setAgencyIdState] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('administry_agency_id') ?? ''
    setAgencyIdState(stored)
  }, [])

  function setAgencyId(id: string) {
    setAgencyIdState(id)
    localStorage.setItem('administry_agency_id', id)
  }

  return (
    <AgencyContext.Provider value={{ agencyId, setAgencyId }}>
      {children}
    </AgencyContext.Provider>
  )
}

export function useAgency() {
  return useContext(AgencyContext)
}
