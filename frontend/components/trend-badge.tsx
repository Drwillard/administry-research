import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

type Trend = 'increasing' | 'stable' | 'decreasing'

const STYLES: Record<Trend, { icon: typeof TrendingUp; cls: string }> = {
  increasing: { icon: TrendingUp,   cls: 'text-emerald-600' },
  stable:     { icon: Minus,        cls: 'text-gray-400' },
  decreasing: { icon: TrendingDown, cls: 'text-rose-500' },
}

export function TrendBadge({ trend, size = 14 }: { trend: Trend; size?: number }) {
  const { icon: Icon, cls } = STYLES[trend]
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', cls)}>
      <Icon size={size} />
      <span className="capitalize">{trend}</span>
    </span>
  )
}

export function SlopeChip({ slope }: { slope: number }) {
  const positive = slope > 0.001
  const negative = slope < -0.001
  return (
    <span className={cn(
      'font-mono text-xs tabular-nums',
      positive ? 'text-emerald-600' : negative ? 'text-rose-500' : 'text-gray-400',
    )}>
      {slope > 0 ? '+' : ''}{slope.toFixed(4)}
    </span>
  )
}

export function SentimentBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.abs(value / max) * 100
  const positive = value >= 0.05
  const negative = value <= -0.05
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            positive ? 'bg-emerald-500' : negative ? 'bg-rose-400' : 'bg-gray-400',
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={cn(
        'text-xs font-mono tabular-nums w-12 text-right',
        positive ? 'text-emerald-600' : negative ? 'text-rose-500' : 'text-gray-400',
      )}>
        {value.toFixed(3)}
      </span>
    </div>
  )
}

export function RiskBar({ score }: { score: number }) {
  const pct = Math.min(score * 100, 100)
  const color = score >= 0.65 ? 'bg-rose-400' : score >= 0.35 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums text-gray-500 w-10">{score.toFixed(3)}</span>
    </div>
  )
}
