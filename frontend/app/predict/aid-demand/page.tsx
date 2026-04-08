'use client'
import { useEffect, useState } from 'react'
import { Banknote } from 'lucide-react'
import { api, type AidDemandResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import { PageShell, Card, LoadingRows, EmptyState, ErrorState, FilterBar } from '@/components/page-shell'
import { TrendBadge } from '@/components/trend-badge'
import { ConfidenceBadge } from '@/components/risk-badge'
import { fmtCurrency, fmtNumber, shortKey } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

export default function AidDemandPage() {
  const { agencyId } = useAgency()
  const [data, setData]           = useState<AidDemandResult[] | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [horizonDays, setHorizonDays] = useState(90)

  useEffect(() => {
    setLoading(true); setError('')
    api.aidDemand({ agencyId: agencyId || undefined, horizonDays, limit: 200 })
      .then(r => { setData(r.results); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, horizonDays])

  const totalForecast = data?.reduce((s, r) => s + (r.forecast_total_aid ?? 0), 0) ?? 0
  const totalAvg      = data?.reduce((s, r) => s + (r.avg_monthly_aid ?? 0), 0) ?? 0
  const increasing    = data?.filter(r => r.trend === 'increasing').length ?? 0
  const decreasing    = data?.filter(r => r.trend === 'decreasing').length ?? 0

  const TREND_COLOR: Record<string, string> = {
    increasing: '#10b981', stable: '#9ca3af', decreasing: '#ef4444',
  }

  const chartData = data?.map(r => ({
    name: shortKey(r.agency_key),
    forecast: r.forecast_total_aid,
    avg: r.avg_monthly_aid,
    trend: r.trend,
  })) ?? []

  return (
    <PageShell
      icon={Banknote}
      title="Aid Demand Forecast"
      description="Projected pledge dollar totals per agency based on monthly trend"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="space-y-1">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Total forecast</div>
            <div className="text-2xl font-bold text-gray-900">{loading ? '…' : fmtCurrency(totalForecast)}</div>
            <div className="text-xs text-gray-400">next {horizonDays} days</div>
          </Card>
          <Card className="space-y-1">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Combined avg/mo</div>
            <div className="text-2xl font-bold text-gray-900">{loading ? '…' : fmtCurrency(totalAvg)}</div>
            <div className="text-xs text-gray-400">historical average</div>
          </Card>
          <Card className="space-y-1">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Increasing</div>
            <div className="text-2xl font-bold text-emerald-600">{loading ? '…' : increasing}</div>
            <div className="text-xs text-gray-400">agencies trending up</div>
          </Card>
          <Card className="space-y-1">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Decreasing</div>
            <div className="text-2xl font-bold text-rose-500">{loading ? '…' : decreasing}</div>
            <div className="text-xs text-gray-400">agencies trending down</div>
          </Card>
        </div>

        <Card>
          <FilterBar>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Forecast horizon (days)</label>
              <input
                type="number" min={7} max={365} value={horizonDays}
                onChange={e => setHorizonDays(Number(e.target.value))}
                className="w-24 bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-violet-400"
              />
            </div>
            <p className="text-xs text-gray-400 self-end pb-1">
              Forecast recomputed from stored slope × horizon. Longer horizons amplify trend uncertainty.
            </p>
          </FilterBar>
        </Card>

        {!loading && chartData.length > 1 && (
          <Card>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
              Forecast vs historical avg — per agency
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ left: 16, right: 8, top: 4, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} width={60} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e2e5ed', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(v: number) => [fmtCurrency(v)]}
                />
                <ReferenceLine y={0} stroke="#e2e5ed" />
                <Bar dataKey="avg"      name="Avg/mo"   fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="forecast" name="Forecast"  radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={TREND_COLOR[entry.trend]} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={4} /> : !data?.length ? (
          <EmptyState message="No aid demand data. Run /ingest/predict first." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.map(r => (
              <Card key={r.agency_key} className="hover:border-gray-300 transition-colors space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-400">Agency {shortKey(r.agency_key)}</span>
                  <TrendBadge trend={r.trend} size={13} />
                </div>

                <div>
                  <div className="text-2xl font-bold text-gray-900">{fmtCurrency(r.forecast_total_aid)}</div>
                  <div className="text-xs text-gray-400">forecast / {horizonDays}d</div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-surface-border pt-3">
                  <div>
                    <div className="text-gray-400">Avg/mo</div>
                    <div className="text-gray-700 font-medium">{fmtCurrency(r.avg_monthly_aid)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Recent 3mo</div>
                    <div className="text-gray-700 font-medium">{fmtCurrency(r.recent_3mo_avg_aid)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Slope/mo</div>
                    <div className={`tabular-nums font-mono font-medium ${r.slope_per_month > 0 ? 'text-emerald-600' : r.slope_per_month < 0 ? 'text-rose-500' : 'text-gray-400'}`}>
                      {r.slope_per_month > 0 ? '+' : ''}{fmtCurrency(r.slope_per_month)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-1">Confidence</div>
                    <ConfidenceBadge confidence={r.confidence} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-gray-400 border-t border-surface-border pt-2">
                  <span>{r.months_of_data} months of data</span>
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
