import { type LucideIcon } from 'lucide-react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PageShell({
  icon: Icon, title, description, children, actions,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="min-h-screen animate-fade-in">
      {/* Header */}
      <div className="border-b border-surface-border bg-white sticky top-0 z-10 shadow-sm">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900">{title}</h1>
              <p className="text-xs text-gray-500">{description}</p>
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      <div className="px-8 py-6">{children}</div>
    </div>
  )
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-surface-border bg-white p-5 shadow-sm', className)}>
      {children}
    </div>
  )
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />
      ))}
    </div>
  )
}

export function EmptyState({ message = 'No data found. Run /ingest first.' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 border border-surface-border flex items-center justify-center mb-3">
        <span className="text-2xl">🔭</span>
      </div>
      <div className="text-gray-500 text-sm">{message}</div>
    </div>
  )
}

export function ErrorState({ error }: { error: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
      {error}
    </div>
  )
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 flex-wrap">{children}</div>
}

export function FilterSelect({
  value, onChange, options, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-white border border-surface-border rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-violet-400 transition-colors appearance-none cursor-pointer"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-surface-border bg-white shadow-sm">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn(
      'px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-surface-border',
      className,
    )}>
      {children}
    </th>
  )
}

export function SortableTh({
  children, colKey, sortKey, sortDir, onSort, className,
}: {
  children: React.ReactNode
  colKey: string
  sortKey: string
  sortDir: 'asc' | 'desc'
  onSort: (key: string) => void
  className?: string
}) {
  const active = sortKey === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-50 border-b border-surface-border cursor-pointer select-none whitespace-nowrap',
        active ? 'text-violet-600' : 'text-gray-500 hover:text-gray-700',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active
          ? sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
          : <ChevronsUpDown size={12} className="opacity-30" />}
      </span>
    </th>
  )
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn('px-4 py-3 border-b border-surface-border text-gray-700', className)}>
      {children}
    </td>
  )
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn('hover:bg-surface-raised transition-colors', className)}>
      {children}
    </tr>
  )
}
