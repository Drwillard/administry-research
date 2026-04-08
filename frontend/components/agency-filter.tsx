'use client'
import { useState, useEffect } from 'react'
import { Building2, X } from 'lucide-react'
import { useAgency } from '@/app/providers'

export function AgencyFilter() {
  const { agencyId, setAgencyId } = useAgency()
  const [draft, setDraft] = useState(agencyId)

  useEffect(() => { setDraft(agencyId) }, [agencyId])

  function apply(e: React.FormEvent) {
    e.preventDefault()
    setAgencyId(draft.trim())
  }

  function clear() {
    setDraft('')
    setAgencyId('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
        <Building2 size={10} />
        Agency Filter
      </div>
      <form onSubmit={apply} className="flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Agency ID…"
          className="flex-1 min-w-0 bg-surface-raised border border-surface-border rounded-md px-2 py-1 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-violet-400 transition-colors"
        />
        {agencyId && (
          <button
            type="button"
            onClick={clear}
            className="px-1.5 py-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-surface-raised transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </form>
      {agencyId && (
        <div className="text-[10px] text-violet-600 truncate">
          Filtering: {agencyId}
        </div>
      )}
    </div>
  )
}
