'use client'
import { useEffect, useState, useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import { api, type ServiceDemandResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import { PageShell, Card, LoadingRows, EmptyState, ErrorState, FilterBar } from '@/components/page-shell'
import { TrendBadge } from '@/components/trend-badge'
import { ConfidenceBadge } from '@/components/risk-badge'
import { fmtNumber, shortKey } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export default function ServiceDemandPage() {
  const { agencyId } = useAgency()
  const [data, setData]           = useState<ServiceDemandResult[] | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [horizonDays, setHorizonDays] = useState(90)
  const [serviceType, setServiceType] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    api.serviceDemand({ agencyId: agencyId || undefined, serviceType: serviceType || undefined, horizonDays, limit: 200 })
      .then(r => { setData(r.results); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, serviceType, horizonDays])

  const serviceTypes = useMemo(() => data ? [...new Set(data.map(r => r.service_type))].sort() : [], [data])

  const chartData = useMemo(() => {
    if (!data) return []
    return [...data]
      .sort((a, b) => b.forecast_referrals - a.forecast_referrals)
      .slice(0, 20)
      .map(r => ({
        name: r.service_name.length > 20 ? r.service_name.slice(0, 20) + '…' : r.service_name,
        forecast: r.forecast_referrals,
        trend: r.trend,
      }))
  }, [data])

  const TREND_COLOR: Record<string, string> = {
    increasing: '#10b981', stable: '#9ca3af', decreasing: '#ef4444',
  }

  const filtered = serviceType ? data?.filter(r => r.service_type === serviceType) : data

  return (
    <PageShell
      icon={TrendingUp}
      title="Service Demand Forecast"
      description="Projected referral volume per service based on historical trend"
    >
      <div className="space-y-4">
        <Card>
          <FilterBar>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Forecast horizon (days)</label>
                <input
                  type="number" min={7} max={365} value={horizonDays}
                  onChange={e => setHorizonDays(Number(e.target.value))}
                  className="w-24 bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-violet-400"
                />
              </div>
              {serviceTypes.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Service type</label>
                  <select
                    value={serviceType} onChange={e => setServiceType(e.target.value)}
                    className="bg-white border border-surface-border rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-violet-400 appearance-none cursor-pointer"
                  >
                    <option value="">All types</option>
                    {serviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
          </FilterBar>
        </Card>

        {!loading && chartData.length > 0 && (
          <Card>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
              Top {chartData.length} services by forecasted referrals — next {horizonDays}d
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ left: 0, right: 8, top: 0, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} width={32} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e2e5ed', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(v: number) => [v.toFixed(1), 'Forecast']}
                />
                <Bar dataKey="forecast" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={TREND_COLOR[entry.trend]} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={6} /> : !filtered?.length ? (
          <EmptyState message="No service demand data. Run /ingest/predict first." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(r => (
              <Card key={`${r.agency_key}-${r.service_name}`} className="hover:border-gray-300 transition-colors space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{r.service_name}</div>
                    <div className="text-xs text-gray-400 truncate">{r.service_type}</div>
                  </div>
                  <TrendBadge trend={r.trend} size={13} />
                </div>

                <div>
                  <div className="text-2xl font-bold text-gray-900 tabular-nums">{r.forecast_referrals.toFixed(1)}</div>
                  <div className="text-xs text-gray-400">forecast referrals / {horizonDays}d</div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-surface-border pt-3">
                  <div>
                    <div className="text-gray-400">Avg/mo</div>
                    <div className="text-gray-700 tabular-nums font-medium">{fmtNumber(r.avg_monthly_referrals, 1)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Recent 3mo</div>
                    <div className="text-gray-700 tabular-nums font-medium">{fmtNumber(r.recent_3mo_avg, 1)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Months data</div>
                    <div className="text-gray-700 tabular-nums font-medium">{r.months_of_data}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-1">Confidence</div>
                    <ConfidenceBadge confidence={r.confidence} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-gray-400 border-t border-surface-border pt-2">
                  <span>Agency {shortKey(r.agency_key)}</span>
                  {r.r_squared != null && <span>R² {r.r_squared.toFixed(2)}</span>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
