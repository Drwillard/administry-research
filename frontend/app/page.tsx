'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Flame, AlertTriangle, CalendarX, UserCheck,
  TrendingUp, Banknote, FileText, Activity,
  ArrowRight, Circle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAgency } from './providers'
import { StatCard } from '@/components/stat-card'
import { IngestControls } from '@/components/ingest-controls'
import { Card } from '@/components/page-shell'

interface DashStats {
  authorsBurning: number
  clientsAtRisk: number
  highNoShow: number
  churned: number
  healthy: boolean
}

const QUICK_LINKS = [
  { href: '/burnout',              icon: Flame,        label: 'Author Burnout',    desc: 'Declining sentiment in caseworker notes',    cls: 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700' },
  { href: '/clients-at-risk',      icon: AlertTriangle,label: 'Clients at Risk',   desc: 'Clients whose note sentiment is declining',  cls: 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700' },
  { href: '/predict/noshow',       icon: CalendarX,    label: 'No-Show Risk',      desc: 'Predicted appointment non-attendance',       cls: 'border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700' },
  { href: '/predict/reengagement', icon: UserCheck,    label: 'Re-engagement',     desc: 'Clients overdue for their next contact',     cls: 'border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700' },
  { href: '/predict/service-demand',icon: TrendingUp,  label: 'Service Demand',    desc: 'Referral volume forecasts by service type',  cls: 'border-cyan-200 bg-cyan-50 hover:bg-cyan-100 text-cyan-700' },
  { href: '/predict/aid-demand',   icon: Banknote,     label: 'Aid Demand',        desc: 'Projected pledge dollars needed per agency', cls: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700' },
  { href: '/notes',                icon: FileText,     label: 'Notes',             desc: 'Browse ingested case notes with sentiment',  cls: 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700' },
]

export default function DashboardPage() {
  const { agencyId } = useAgency()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const p = agencyId ? { agencyId } : undefined
    Promise.all([
      api.health().catch(() => null),
      api.authorBurnout({ ...p, limit: 1 }).catch(() => null),
      api.clientsAtRisk({ ...p, limit: 1 }).catch(() => null),
      api.noshowRisk({ ...p, riskLevel: 'high', limit: 1 }).catch(() => null),
      api.reengagement({ ...p, status: 'churned', limit: 1 }).catch(() => null),
    ]).then(([health, burnout, atRisk, noshow, churned]) => {
      setStats({
        healthy: health?.status === 'ok',
        authorsBurning: burnout?.authors_flagged ?? 0,
        clientsAtRisk: atRisk?.clients_flagged ?? 0,
        highNoShow: noshow?.total ?? 0,
        churned: churned?.total ?? 0,
      })
      setLoading(false)
    })
  }, [agencyId])

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="border-b border-surface-border bg-white">
        <div className="px-8 py-10">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-violet-500" />
            <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">Research Dashboard</span>
            {stats && (
              <span className={`ml-2 flex items-center gap-1.5 text-xs font-medium ${stats.healthy ? 'text-emerald-600' : 'text-rose-500'}`}>
                <Circle size={6} className={stats.healthy ? 'fill-emerald-500' : 'fill-rose-500'} />
                {stats.healthy ? 'API healthy' : 'API unreachable'}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">
            Administry Research
          </h1>
          <p className="text-gray-500 text-sm">
            Analytics & predictive insights across case notes, pledges, referrals, and appointments.
            {agencyId && <span className="ml-1 text-violet-600 font-medium">Filtered to agency {agencyId}.</span>}
          </p>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Authors Flagged"   value={stats?.authorsBurning ?? '—'} sub="declining sentiment"  icon={Flame}         accent="rose"    loading={loading} />
          <StatCard label="Clients at Risk"   value={stats?.clientsAtRisk ?? '—'}  sub="declining sentiment"  icon={AlertTriangle}  accent="amber"   loading={loading} />
          <StatCard label="High No-Show Risk" value={stats?.highNoShow ?? '—'}      sub="appointments"         icon={CalendarX}     accent="violet"  loading={loading} />
          <StatCard label="Churned Clients"   value={stats?.churned ?? '—'}         sub="> 180 days inactive"  icon={UserCheck}     accent="cyan"    loading={loading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick links */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Analysis Modules</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_LINKS.map(({ href, icon: Icon, label, desc, cls }) => (
                <Link
                  key={href}
                  href={href}
                  className={`group flex items-start gap-3 p-4 rounded-xl border transition-all duration-150 ${cls}`}
                >
                  <Icon size={16} className="mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs opacity-60 mt-0.5 leading-snug">{desc}</div>
                  </div>
                  <ArrowRight size={13} className="ml-auto flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity mt-0.5" />
                </Link>
              ))}
            </div>
          </div>

          {/* Pipeline */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pipeline</h2>
            <Card>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Trigger the data pipeline to re-fetch from the database, run analysis,
                and refresh predictive models.
              </p>
              <IngestControls />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
