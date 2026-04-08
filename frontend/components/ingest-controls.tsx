'use client'
import { useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Brain, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type State = 'idle' | 'loading' | 'ok' | 'err'

interface ButtonConfig {
  label: string
  subtitle: string
  steps: { icon: string; text: string; dim?: boolean }[]
  icon: typeof Brain
  accentIdle: string
  accentIcon: string
  onClick: () => void
  state: State
}

function IngestButton({ label, subtitle, steps, icon: Icon, accentIdle, accentIcon, onClick, state }: ButtonConfig) {
  const busy = state === 'loading'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        'w-full text-left rounded-xl border p-4 transition-all duration-200',
        busy          && 'opacity-60 cursor-not-allowed border-gray-200 bg-gray-50',
        state === 'ok'  && 'border-emerald-200 bg-emerald-50',
        state === 'err' && 'border-rose-200 bg-rose-50',
        state === 'idle' && cn('bg-white border-surface-border shadow-sm', accentIdle),
      )}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'rounded-lg p-2 flex-shrink-0',
          state === 'ok'  ? 'bg-emerald-100 text-emerald-600' :
          state === 'err' ? 'bg-rose-100 text-rose-600' :
          busy            ? 'bg-gray-100 text-gray-400' :
                            accentIcon,
        )}>
          {busy            ? <RefreshCw size={16} className="animate-spin" /> :
           state === 'ok'  ? <CheckCircle2 size={16} /> :
           state === 'err' ? <XCircle size={16} /> :
                             <Icon size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">{label}</div>
          <div className="text-xs text-gray-500">{subtitle}</div>
        </div>
        {state === 'ok'  && <span className="text-xs text-emerald-600 font-medium">Queued ✓</span>}
        {state === 'err' && <span className="text-xs text-rose-600 font-medium">Failed</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {steps.map((step, i) => (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border',
              step.dim
                ? 'border-gray-200 text-gray-300 bg-white'
                : 'border-gray-200 bg-gray-50 text-gray-500',
            )}
          >
            <span>{step.icon}</span>
            {step.text}
          </span>
        ))}
      </div>

      {state === 'err' && (
        <div className="mt-2 text-xs text-rose-500">Check backend logs for details.</div>
      )}
    </button>
  )
}

export function IngestControls() {
  const [ingestState,  setIngestState]  = useState<State>('idle')
  const [predictState, setPredictState] = useState<State>('idle')

  async function triggerIngest() {
    setIngestState('loading')
    try   { await api.ingest();        setIngestState('ok') }
    catch { setIngestState('err') }
  }

  async function triggerPredict() {
    setPredictState('loading')
    try   { await api.ingestPredict(); setPredictState('ok') }
    catch { setPredictState('err') }
  }

  return (
    <div className="space-y-2">
      <IngestButton
        label="Full Ingest"
        subtitle="Runs everything — takes several minutes"
        steps={[
          { icon: '🗄️', text: 'Fetch notes & pledges' },
          { icon: '🧹', text: 'Scrub PII' },
          { icon: '💬', text: 'Sentiment analysis' },
          { icon: '🧠', text: 'LLM summaries' },
          { icon: '📊', text: 'TF-IDF / NMF topics' },
          { icon: '🔮', text: 'Predictive models' },
        ]}
        icon={Brain}
        accentIdle="hover:border-violet-300 hover:bg-violet-50"
        accentIcon="bg-violet-100 text-violet-600"
        onClick={triggerIngest}
        state={ingestState}
      />
      <IngestButton
        label="Predictions Only"
        subtitle="No summarization — fast, safe to re-run"
        steps={[
          { icon: '📅', text: 'No-show risk' },
          { icon: '👤', text: 'Re-engagement' },
          { icon: '📈', text: 'Service demand' },
          { icon: '💰', text: 'Aid demand' },
          { icon: '🧠', text: 'LLM summaries', dim: true },
        ]}
        icon={TrendingUp}
        accentIdle="hover:border-cyan-300 hover:bg-cyan-50"
        accentIcon="bg-cyan-100 text-cyan-600"
        onClick={triggerPredict}
        state={predictState}
      />
    </div>
  )
}
