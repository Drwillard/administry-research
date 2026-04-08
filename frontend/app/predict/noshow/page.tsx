'use client'
import { useEffect, useState } from 'react'
import { CalendarX } from 'lucide-react'
import { api, type NoShowResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import {
  PageShell, Card, LoadingRows, EmptyState, ErrorState,
  FilterBar, FilterSelect, Table, Th, Td, Tr,
} from '@/components/page-shell'
import { RiskBadge } from '@/components/risk-badge'
import { RiskBar } from '@/components/trend-badge'
import { StatCard } from '@/components/stat-card'
import { shortKey, fmtPct, fmtNumber } from '@/lib/utils'

const RISK_LEVELS = [
  { value: '',       label: 'All levels' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
]

export default function NoShowPage() {
  const { agencyId } = useAgency()
  const [data, setData]         = useState<NoShowResult[] | null>(null)
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [riskLevel, setRiskLevel] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    api.noshowRisk({ agencyId: agencyId || undefined, riskLevel: riskLevel || undefined, limit: 200 })
      .then(r => { setData(r.results); setTotal(r.total); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, riskLevel])

  const byLevel = (lvl: string) => data?.filter(r => r.risk_level === lvl).length ?? 0

  return (
    <PageShell
      icon={CalendarX}
      title="No-Show Risk"
      description="Predicted appointment non-attendance based on history, inactivity & household size"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="High Risk"   value={loading ? '…' : byLevel('high')}   accent="rose"    />
          <StatCard label="Medium Risk" value={loading ? '…' : byLevel('medium')} accent="amber"   />
          <StatCard label="Low Risk"    value={loading ? '…' : byLevel('low')}    accent="emerald" />
        </div>

        <Card>
          <FilterBar>
            <FilterSelect value={riskLevel} onChange={setRiskLevel} options={RISK_LEVELS} placeholder="All levels" />
            {total > 0 && <span className="text-xs text-gray-400">{total} clients scored</span>}
          </FilterBar>
        </Card>

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={8} /> : !data?.length ? (
          <EmptyState message="No no-show risk data. Run /ingest/predict first." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th><Th>Risk</Th><Th>Score</Th><Th>Appts</Th>
                <Th>No-shows</Th><Th>No-show rate</Th><Th>Days since last</Th><Th>Avg HH size</Th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <Tr key={`${r.agency_key}-${r.client_key}`}>
                  <Td><span className="font-mono text-xs text-gray-400">{shortKey(r.client_key)}</span></Td>
                  <Td><RiskBadge level={r.risk_level} /></Td>
                  <Td><RiskBar score={r.risk_score} /></Td>
                  <Td><span className="tabular-nums">{r.total_appointments}</span></Td>
                  <Td><span className="tabular-nums text-rose-500 font-medium">{r.noshows}</span></Td>
                  <Td><span className="tabular-nums">{fmtPct(r.noshow_rate)}</span></Td>
                  <Td>
                    <span className={`tabular-nums text-xs font-medium ${r.days_since_last_appointment > 180 ? 'text-rose-500' : r.days_since_last_appointment > 90 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {fmtNumber(r.days_since_last_appointment)}d
                    </span>
                  </Td>
                  <Td><span className="tabular-nums text-xs">{r.avg_household_size.toFixed(1)}</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </PageShell>
  )
}
