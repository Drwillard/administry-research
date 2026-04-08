// All paths go through Next.js rewrite: /api/* → backend:8000/*
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${msg}`)
  }
  return res.json() as Promise<T>
}

// ─── Response types ────────────────────────────────────────────────────────

export interface HealthResponse { status: string }

export interface SentimentResult {
  note_count: number
  slope: number
  early_avg_sentiment: number
  recent_avg_sentiment: number
  delta: number
  first_note: string
  last_note: string
}

export interface AuthorBurnoutResult extends SentimentResult {
  author_key: string
}

export interface ClientAtRiskResult extends SentimentResult {
  client_key: string
}

export interface NoteResult {
  event_id: string
  agency_key: string | null
  client_key: string | null
  author_key: string | null
  ddate: string
  vnote: string | null
  sentiment_compound: number | null
  sentiment_label: string | null
  tone: string | null
  summary: string | null
}

export interface NoShowResult {
  agency_key: string
  client_key: string
  total_appointments: number
  noshows: number
  noshow_rate: number
  days_since_last_appointment: number
  avg_household_size: number
  risk_score: number
  risk_level: 'high' | 'medium' | 'low'
}

export interface ReengagementResult {
  agency_key: string
  client_key: string
  last_activity: string
  days_inactive: number
  total_events: number
  distinct_activity_types: number
  avg_days_between_events: number | null
  status: 'active' | 'at_risk' | 'lapsed' | 'churned'
  reengagement_risk: number
}

export interface ServiceDemandResult {
  agency_key: string
  service_name: string
  service_type: string
  months_of_data: number
  avg_monthly_referrals: number
  recent_3mo_avg: number
  trend: 'increasing' | 'stable' | 'decreasing'
  slope: number
  r_squared: number | null
  confidence: 'high' | 'medium' | 'low'
  horizon_days: number
  forecast_referrals: number
}

export interface AidDemandResult {
  agency_key: string
  months_of_data: number
  avg_monthly_aid: number
  recent_3mo_avg_aid: number
  trend: 'increasing' | 'stable' | 'decreasing'
  slope_per_month: number
  r_squared: number | null
  confidence: 'high' | 'medium' | 'low'
  horizon_days: number
  forecast_total_aid: number
}

export interface Paginated<T> {
  total: number
  offset: number
  limit: number
  results: T[]
}

// ─── API client ────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  health: () => apiFetch<HealthResponse>('/health'),

  ingest: () =>
    apiFetch<{ status: string; message: string }>('/ingest', { method: 'POST' }),

  ingestPredict: (horizonDays = 90) =>
    apiFetch<{ status: string; horizon_days: number }>(
      `/ingest/predict${qs({ horizon_days: horizonDays })}`,
      { method: 'POST' },
    ),

  authorBurnout: (p?: { agencyId?: string; minNotes?: number; limit?: number; slopeThreshold?: number }) =>
    apiFetch<{ authors_flagged: number; min_notes_filter: number; slope_threshold: number; results: AuthorBurnoutResult[] }>(
      `/analyze/author-burnout${qs({ agency_id: p?.agencyId, min_notes: p?.minNotes, limit: p?.limit ?? 100, slope_threshold: p?.slopeThreshold })}`,
    ),

  clientsAtRisk: (p?: { agencyId?: string; minNotes?: number; limit?: number }) =>
    apiFetch<{ clients_flagged: number; min_notes_filter: number; slope_threshold: number; results: ClientAtRiskResult[] }>(
      `/analyze/clients-at-risk${qs({ agency_id: p?.agencyId, min_notes: p?.minNotes, limit: p?.limit ?? 100 })}`,
    ),

  notes: (p?: { agencyId?: string; clientId?: string; limit?: number; offset?: number }) =>
    apiFetch<Paginated<NoteResult>>(
      `/notes${qs({ agency_id: p?.agencyId, client_id: p?.clientId, limit: p?.limit ?? 50, offset: p?.offset })}`,
    ),

  noshowRisk: (p?: { agencyId?: string; riskLevel?: string; limit?: number; offset?: number }) =>
    apiFetch<Paginated<NoShowResult>>(
      `/predict/noshowrisk${qs({ agency_id: p?.agencyId, risk_level: p?.riskLevel, limit: p?.limit ?? 100, offset: p?.offset })}`,
    ),

  reengagement: (p?: { agencyId?: string; status?: string; limit?: number; offset?: number }) =>
    apiFetch<Paginated<ReengagementResult>>(
      `/predict/reengagement${qs({ agency_id: p?.agencyId, status: p?.status, limit: p?.limit ?? 100, offset: p?.offset })}`,
    ),

  serviceDemand: (p?: { agencyId?: string; serviceType?: string; horizonDays?: number; limit?: number; offset?: number }) =>
    apiFetch<Paginated<ServiceDemandResult>>(
      `/predict/service-demand${qs({ agency_id: p?.agencyId, service_type: p?.serviceType, horizon_days: p?.horizonDays, limit: p?.limit ?? 200, offset: p?.offset })}`,
    ),

  aidDemand: (p?: { agencyId?: string; horizonDays?: number; limit?: number }) =>
    apiFetch<Paginated<AidDemandResult>>(
      `/predict/aid-demand${qs({ agency_id: p?.agencyId, horizon_days: p?.horizonDays, limit: p?.limit ?? 200 })}`,
    ),
}
