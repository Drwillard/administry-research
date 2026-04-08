import { cn } from '@/lib/utils'

type RiskLevel  = 'high' | 'medium' | 'low'
type Status     = 'active' | 'at_risk' | 'lapsed' | 'churned'
type Confidence = 'high' | 'medium' | 'low'

const RISK_STYLES: Record<RiskLevel, string> = {
  high:   'bg-rose-100 text-rose-700 border-rose-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low:    'bg-emerald-100 text-emerald-700 border-emerald-200',
}

const STATUS_STYLES: Record<Status, string> = {
  active:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  at_risk: 'bg-amber-100 text-amber-700 border-amber-200',
  lapsed:  'bg-orange-100 text-orange-700 border-orange-200',
  churned: 'bg-rose-100 text-rose-700 border-rose-200',
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low:    'bg-gray-100 text-gray-500 border-gray-200',
}

const STATUS_LABELS: Record<Status, string> = {
  active: 'Active', at_risk: 'At Risk', lapsed: 'Lapsed', churned: 'Churned',
}

const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border'

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={cn(base, RISK_STYLES[level])}>{level.charAt(0).toUpperCase() + level.slice(1)}</span>
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={cn(base, STATUS_STYLES[status])}>{STATUS_LABELS[status]}</span>
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <span className={cn(base, CONFIDENCE_STYLES[confidence])}>{confidence.charAt(0).toUpperCase() + confidence.slice(1)}</span>
}

export function SentimentBadge({ label }: { label: string | null }) {
  const styles: Record<string, string> = {
    positive: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    negative: 'bg-rose-100 text-rose-700 border-rose-200',
    neutral:  'bg-gray-100 text-gray-500 border-gray-200',
  }
  if (!label) return null
  return <span className={cn(base, styles[label] ?? styles.neutral)}>{label}</span>
}
