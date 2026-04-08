'use client'
import { useEffect, useState, useCallback } from 'react'
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, type NoteResult } from '@/lib/api'
import { useAgency } from '@/app/providers'
import { PageShell, Card, LoadingRows, EmptyState, ErrorState, FilterBar } from '@/components/page-shell'
import { SentimentBadge } from '@/components/risk-badge'
import { fmtDate, shortKey } from '@/lib/utils'

const PAGE_SIZE = 25

export default function NotesPage() {
  const { agencyId } = useAgency()
  const [data, setData]       = useState<NoteResult[] | null>(null)
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [offset, setOffset]   = useState(0)
  const [clientId, setClientId]       = useState('')
  const [clientDraft, setClientDraft] = useState('')

  const load = useCallback(() => {
    setLoading(true); setError('')
    api.notes({ agencyId: agencyId || undefined, clientId: clientId || undefined, limit: PAGE_SIZE, offset })
      .then(r => { setData(r.results); setTotal(r.total); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agencyId, clientId, offset])

  useEffect(() => { setOffset(0) }, [agencyId, clientId])
  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const page = Math.floor(offset / PAGE_SIZE) + 1

  function toneColor(tone: string | null) {
    const map: Record<string, string> = {
      optimistic: 'text-emerald-600', concerned: 'text-rose-500',
      mixed: 'text-amber-600', objective: 'text-cyan-600', neutral: 'text-gray-400',
    }
    return tone ? (map[tone] ?? 'text-gray-400') : 'text-gray-400'
  }

  return (
    <PageShell
      icon={FileText}
      title="Notes"
      description="Ingested case notes and pledge events with sentiment analysis"
      actions={<span className="text-xs text-gray-400">{total.toLocaleString()} total</span>}
    >
      <div className="space-y-4">
        <Card>
          <FilterBar>
            <form onSubmit={e => { e.preventDefault(); setClientId(clientDraft.trim()) }} className="flex gap-2">
              <input
                type="text" value={clientDraft}
                onChange={e => setClientDraft(e.target.value)}
                placeholder="Filter by client key…"
                className="w-52 bg-white border border-surface-border rounded-lg px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-violet-400 transition-colors"
              />
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition-colors">
                Apply
              </button>
              {clientId && (
                <button type="button" onClick={() => { setClientDraft(''); setClientId('') }}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-gray-600 text-xs hover:bg-gray-200 transition-colors">
                  Clear
                </button>
              )}
            </form>
          </FilterBar>
        </Card>

        {error && <ErrorState error={error} />}

        {loading ? <LoadingRows rows={6} /> : !data?.length ? (
          <EmptyState message="No notes found. Run /ingest first." />
        ) : (
          <>
            <div className="space-y-2">
              {data.map(note => (
                <Card key={note.event_id} className="hover:border-gray-300 transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                        note.event_id.startsWith('n-')
                          ? 'border-violet-200 bg-violet-50 text-violet-600'
                          : 'border-cyan-200 bg-cyan-50 text-cyan-600'
                      }`}>
                        {note.event_id.startsWith('n-') ? 'note' : 'pledge'}
                      </span>
                      <span className="font-mono text-xs text-gray-400">{shortKey(note.client_key)}</span>
                      {note.author_key && (
                        <span className="text-xs text-gray-400">by {shortKey(note.author_key)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SentimentBadge label={note.sentiment_label} />
                      {note.tone && (
                        <span className={`text-xs font-medium ${toneColor(note.tone)}`}>{note.tone}</span>
                      )}
                      <span className="text-xs text-gray-400">{fmtDate(note.ddate)}</span>
                    </div>
                  </div>

                  {note.summary && (
                    <div className="text-xs text-violet-600 italic mb-2 border-l-2 border-violet-300 pl-2 bg-violet-50 py-1 rounded-r">
                      {note.summary}
                    </div>
                  )}

                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
                    {note.vnote ?? <span className="italic text-gray-300">No text</span>}
                  </p>

                  {note.sentiment_compound != null && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${note.sentiment_compound >= 0.05 ? 'bg-emerald-400' : note.sentiment_compound <= -0.05 ? 'bg-rose-400' : 'bg-gray-400'}`}
                          style={{ width: `${Math.abs(note.sentiment_compound) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-gray-400 tabular-nums">
                        {note.sentiment_compound.toFixed(3)}
                      </span>
                    </div>
                  )}
                </Card>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
                  className="p-1.5 rounded-lg border border-surface-border hover:bg-surface-raised disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <span className="px-3">Page {page} of {totalPages}</span>
                <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
                  className="p-1.5 rounded-lg border border-surface-border hover:bg-surface-raised disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </PageShell>
  )
}
