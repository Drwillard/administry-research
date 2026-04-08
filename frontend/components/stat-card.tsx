import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: LucideIcon
  accent?: 'violet' | 'cyan' | 'rose' | 'amber' | 'emerald'
  loading?: boolean
}

const ACCENT: Record<string, string> = {
  violet:  'from-violet-50 to-white border-violet-200',
  cyan:    'from-cyan-50 to-white border-cyan-200',
  rose:    'from-rose-50 to-white border-rose-200',
  amber:   'from-amber-50 to-white border-amber-200',
  emerald: 'from-emerald-50 to-white border-emerald-200',
}

const ICON_ACCENT: Record<string, string> = {
  violet:  'bg-violet-100 text-violet-600',
  cyan:    'bg-cyan-100 text-cyan-600',
  rose:    'bg-rose-100 text-rose-600',
  amber:   'bg-amber-100 text-amber-600',
  emerald: 'bg-emerald-100 text-emerald-600',
}

const VALUE_ACCENT: Record<string, string> = {
  violet:  'text-violet-700',
  cyan:    'text-cyan-700',
  rose:    'text-rose-600',
  amber:   'text-amber-600',
  emerald: 'text-emerald-600',
}

export function StatCard({ label, value, sub, icon: Icon, accent = 'violet', loading }: StatCardProps) {
  return (
    <div className={cn(
      'relative overflow-hidden rounded-xl border bg-gradient-to-br p-5 transition-all duration-200 hover:scale-[1.01] bg-white',
      ACCENT[accent],
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</div>
          {loading ? (
            <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
          ) : (
            <div className={cn('text-3xl font-bold tabular-nums', VALUE_ACCENT[accent])}>{value}</div>
          )}
          {sub && !loading && (
            <div className="mt-1 text-xs text-gray-400 truncate">{sub}</div>
          )}
        </div>
        {Icon && (
          <div className={cn('rounded-lg p-2 flex-shrink-0', ICON_ACCENT[accent])}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  )
}
