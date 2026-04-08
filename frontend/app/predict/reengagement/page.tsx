'use client'
import { useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { api, type ReengagementResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import {
  PageShell, Card, LoadingRows, EmptyState, ErrorState,
  FilterBar, FilterSelect, Table, Th, Td, Tr,
} from '@/components/page-shell'
import { StatusBadge } from '@/components/risk-badge'
import { RiskBar } from '@/components/trend-badge'
import { StatCard } from '@/components/stat-card'
import { shortKey, fmtDate, fmtNumber } from '@/lib/utils'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const STATUS_OPTIONS = [
  { value: '',        label: 'All statuses' },
  { value: 'active',  label: 'Active' },
  { value: 'at_risk', label: 'At Risk' },
  { value: 'lapsed',  label: 'Lapsed' },
  { value: 'churned', label: 'Churned' },
]

const STATUS_COLORS: Record<string, string> = {
  active: '#10b981', at_risk: '#f59e0b', lapsed: '#f97316', churned: '#ef4444',
}

export default function ReengagementPage() {
  const { agencyId } = useAgency()
  const [allData, setAllData]       = useState<ReengagementResult[] | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    api.reengagement({ agencyId: agencyId || undefined, limit: 500 })
      .then(r => { setAllData(r.results); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId])

  const count = (s: string) => allData?.filter(r => r.status === s).length ?? 0
  const data = statusFilter ? allData?.filter(r => r.status === statusFilter) : allData

  const pieData = ['active', 'at_risk', 'lapsed', 'churned'].map(s => ({
    name: STATUS_OPTIONS.find(o => o.value === s)?.label ?? s,
    value: count(s),
    color: STATUS_COLORS[s],
  })).filter(d => d.value > 0)

  return (
    <PageShell
      icon={UserCheck}
      title="Re-engagement Risk"
      description="Clients overdue for contact relative to their typical activity cadence"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Active"  value={loading ? '…' : count('active')}  accent="emerald" />
          <StatCard label="At Risk" value={loading ? '…' : count('at_risk')} accent="amber"   />
          <StatCard label="Lapsed"  value={loading ? '…' : count('lapsed')}  accent="violet"  />
          <StatCard label="Churned" value={loading ? '…' : count('churned')} accent="rose"    />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {!loading && pieData.length > 0 && (
            <Card className="flex flex-col">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Status distribution</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                    {pieData.map(entry => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #e2e5ed', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#6b7280' }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card className="lg:col-span-2 self-start">
            <FilterBar>
              <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
              {data && <span className="text-xs text-gray-400">{data.length} clients shown</span>}
            </FilterBar>
          </Card>
        </div>

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={8} /> : !data?.length ? (
          <EmptyState message="No re-engagement data. Run /ingest/predict first." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th><Th>Status</Th><Th>Risk score</Th><Th>Last activity</Th>
                <Th>Days inactive</Th><Th>Events</Th><Th>Activity types</Th><Th>Avg cadence</Th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <Tr key={`${r.agency_key}-${r.client_key}`}>
                  <Td><span className="font-mono text-xs text-gray-400">{shortKey(r.client_key)}</span></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td><RiskBar score={r.reengagement_risk} /></Td>
                  <Td><span className="text-xs text-gray-500">{fmtDate(r.last_activity)}</span></Td>
                  <Td>
                    <span className={`tabular-nums text-xs font-medium ${r.days_inactive > 180 ? 'text-rose-500' : r.days_inactive > 90 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {fmtNumber(r.days_inactive)}d
                    </span>
                  </Td>
                  <Td><span className="tabular-nums">{r.total_events}</span></Td>
                  <Td>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className={`w-2 h-2 rounded-sm ${i < r.distinct_activity_types ? 'bg-violet-500' : 'bg-gray-200'}`} />
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <span className="tabular-nums text-xs text-gray-500">
                      {r.avg_days_between_events != null ? `${r.avg_days_between_events.toFixed(0)}d` : '—'}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </PageShell>
  )
}
