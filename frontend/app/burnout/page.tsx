'use client'
import { useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { api, type AuthorBurnoutResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import {
  PageShell, Card, LoadingRows, EmptyState, ErrorState,
  Table, Th, Td, Tr,
} from '@/components/page-shell'
import { SentimentBar, SlopeChip } from '@/components/trend-badge'
import { fmtDate, shortKey } from '@/lib/utils'

export default function BurnoutPage() {
  const { agencyId } = useAgency()
  const [data, setData]           = useState<AuthorBurnoutResult[] | null>(null)
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [minNotes, setMinNotes]   = useState(5)
  const [slopeThreshold, setSlopeThreshold] = useState(0)

  useEffect(() => {
    setLoading(true); setError('')
    api.authorBurnout({ agencyId: agencyId || undefined, minNotes, limit: 100, slopeThreshold })
      .then(r => { setData(r.results); setTotal(r.authors_flagged); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, minNotes, slopeThreshold])

  return (
    <PageShell
      icon={Flame}
      title="Author Burnout"
      description="Caseworkers whose note sentiment is declining over time"
      actions={
        total > 0 ? (
          <span className="px-2 py-1 rounded-full bg-rose-100 border border-rose-200 text-rose-600 text-xs font-medium">
            {total} flagged
          </span>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap gap-6 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min notes</label>
              <input
                type="number" min={1} value={minNotes}
                onChange={e => setMinNotes(Number(e.target.value))}
                className="w-20 bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Max slope (flag below)</label>
              <input
                type="number" step={0.001} value={slopeThreshold}
                onChange={e => setSlopeThreshold(Number(e.target.value))}
                className="w-28 bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-violet-400"
              />
            </div>
          </div>
        </Card>

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={8} /> : !data?.length ? (
          <EmptyState message="No authors flagged with current filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Author</Th><Th>Notes</Th><Th>Slope</Th>
                <Th>Early sentiment</Th><Th>Recent sentiment</Th>
                <Th>Δ Delta</Th><Th>First note</Th><Th>Last note</Th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <Tr key={r.author_key}>
                  <Td><span className="font-mono text-xs text-gray-400">{shortKey(r.author_key)}</span></Td>
                  <Td><span className="tabular-nums">{r.note_count}</span></Td>
                  <Td><SlopeChip slope={r.slope} /></Td>
                  <Td><SentimentBar value={r.early_avg_sentiment} /></Td>
                  <Td><SentimentBar value={r.recent_avg_sentiment} /></Td>
                  <Td>
                    <span className={`text-xs font-mono tabular-nums ${r.delta < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                      {r.delta > 0 ? '+' : ''}{r.delta.toFixed(4)}
                    </span>
                  </Td>
                  <Td><span className="text-xs text-gray-400">{fmtDate(r.first_note)}</span></Td>
                  <Td><span className="text-xs text-gray-400">{fmtDate(r.last_note)}</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </PageShell>
  )
}
