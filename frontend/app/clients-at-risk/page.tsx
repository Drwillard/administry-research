'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api, type ClientAtRiskResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import {
  PageShell, Card, LoadingRows, EmptyState, ErrorState,
  Table, Th, Td, Tr,
} from '@/components/page-shell'
import { SentimentBar, SlopeChip } from '@/components/trend-badge'
import { fmtDate, shortKey } from '@/lib/utils'

export default function ClientsAtRiskPage() {
  const { agencyId } = useAgency()
  const [data, setData]         = useState<ClientAtRiskResult[] | null>(null)
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [minNotes, setMinNotes] = useState(5)

  useEffect(() => {
    setLoading(true); setError('')
    api.clientsAtRisk({ agencyId: agencyId || undefined, minNotes, limit: 100 })
      .then(r => { setData(r.results); setTotal(r.clients_flagged); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, minNotes])

  return (
    <PageShell
      icon={AlertTriangle}
      title="Clients at Risk"
      description="Clients whose case note sentiment is trending downward"
      actions={
        total > 0 ? (
          <span className="px-2 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-700 text-xs font-medium">
            {total} flagged
          </span>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <Card>
          <div className="flex items-end gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min notes required</label>
              <input
                type="number" min={1} value={minNotes}
                onChange={e => setMinNotes(Number(e.target.value))}
                className="w-20 bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-violet-400"
              />
            </div>
            <p className="text-xs text-gray-400 pb-1">
              Sorted by steepest sentiment decline. Higher min-notes reduces noise from sparse records.
            </p>
          </div>
        </Card>

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={8} /> : !data?.length ? (
          <EmptyState message="No clients flagged with current filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th><Th>Notes</Th><Th>Slope</Th>
                <Th>Early sentiment</Th><Th>Recent sentiment</Th>
                <Th>Δ Delta</Th><Th>Window</Th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <Tr key={r.client_key}>
                  <Td><span className="font-mono text-xs text-gray-400">{shortKey(r.client_key)}</span></Td>
                  <Td><span className="tabular-nums">{r.note_count}</span></Td>
                  <Td><SlopeChip slope={r.slope} /></Td>
                  <Td><SentimentBar value={r.early_avg_sentiment} /></Td>
                  <Td><SentimentBar value={r.recent_avg_sentiment} /></Td>
                  <Td>
                    <span className={`text-xs font-mono tabular-nums ${r.delta < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                      {r.delta > 0 ? '+' : ''}{r.delta.toFixed(4)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-gray-400">
                      {fmtDate(r.first_note)} → {fmtDate(r.last_note)}
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
