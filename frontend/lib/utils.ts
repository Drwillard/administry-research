import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/** Show first 8 chars of a HMAC key with ellipsis */
export function shortKey(key: string | null | undefined): string {
  if (!key) return '—'
  return key.slice(0, 8) + '…'
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n)
}

export function fmtNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(n)
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—'
  return (n * 100).toFixed(decimals) + '%'
}

export function sentimentColor(compound: number | null | undefined): string {
  if (compound == null) return 'text-zinc-500'
  if (compound >= 0.05) return 'text-emerald-400'
  if (compound <= -0.05) return 'text-rose-400'
  return 'text-zinc-400'
}
