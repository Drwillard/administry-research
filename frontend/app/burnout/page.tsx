'use client'
import { useEffect, useState, useMemo } from 'react'
import { Flame } from 'lucide-react'
import { api, type AuthorBurnoutResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import {
  PageShell, Card, LoadingRows, EmptyState, ErrorState,
  Table, Th, SortableTh, Td, Tr,
} from '@/components/page-shell'
import { SentimentBar, SlopeChip } from '@/components/trend-badge'
import { fmtDate, shortKey } from '@/lib/utils'

type SortKey = 'author_key' | 'note_count' | 'slope' | 'early_avg_sentiment' | 'recent_avg_sentiment' | 'delta' | 'first_note' | 'last_note'

export default function BurnoutPage() {
  const { agencyId } = useAgency()
  const [data, setData]           = useState<AuthorBurnoutResult[] | null>(null)
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [minNotes, setMinNotes]   = useState(5)
  const [slopeThreshold, setSlopeThreshold] = useState(0)
  const [sortKey, setSortKey]     = useState<SortKey>('slope')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    setLoading(true); setError('')
    api.authorBurnout({ agencyId: agencyId || undefined, minNotes, limit: 100, slopeThreshold })
      .then(r => { setData(r.results); setTotal(r.authors_flagged); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, minNotes, slopeThreshold])

  function handleSort(key: string) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key as SortKey); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!data) return data
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const col = (key: SortKey, label: string) => (
    <SortableTh colKey={key} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>{label}</SortableTh>
  )

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

        {loading ? <LoadingRows rows={8} /> : !sorted?.length ? (
          <EmptyState message="No authors flagged with current filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Author</Th>
                {col('note_count', 'Notes')}
                {col('slope', 'Slope')}
                {col('early_avg_sentiment', 'Early sentiment')}
                {col('recent_avg_sentiment', 'Recent sentiment')}
                {col('delta', 'Δ Delta')}
                {col('first_note', 'First note')}
                {col('last_note', 'Last note')}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
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
