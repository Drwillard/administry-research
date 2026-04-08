'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Flame, AlertTriangle, FileText,
  CalendarX, UserCheck, TrendingUp, Banknote, ChevronRight,
} from 'lucide-react'
import { AgencyFilter } from './agency-filter'
import { cn } from '@/lib/utils'

const NAV = [
  {
    label: 'Overview',
    items: [
      { href: '/',                    icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/burnout',             icon: Flame,           label: 'Author Burnout' },
      { href: '/clients-at-risk',     icon: AlertTriangle,   label: 'Clients at Risk' },
      { href: '/notes',               icon: FileText,        label: 'Notes' },
    ],
  },
  {
    label: 'Predictions',
    items: [
      { href: '/predict/noshow',         icon: CalendarX,  label: 'No-Show Risk' },
      { href: '/predict/reengagement',   icon: UserCheck,  label: 'Re-engagement' },
      { href: '/predict/service-demand', icon: TrendingUp, label: 'Service Demand' },
      { href: '/predict/aid-demand',     icon: Banknote,   label: 'Aid Demand' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 flex flex-col bg-white border-r border-surface-border z-40">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-surface-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">AR</span>
          </div>
          <div>
            <div className="text-gray-900 text-sm font-semibold leading-tight">Administry</div>
            <div className="text-gray-400 text-[10px] leading-tight">Research</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAV.map(section => (
          <div key={section.label}>
            <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map(({ href, icon: Icon, label }) => {
                const active = pathname === href
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-all duration-150 group',
                        active
                          ? 'bg-violet-50 text-violet-700 border border-violet-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-surface-raised',
                      )}
                    >
                      <Icon size={15} className={cn(active ? 'text-violet-600' : 'text-gray-400 group-hover:text-gray-600')} />
                      <span className="flex-1 truncate">{label}</span>
                      {active && <ChevronRight size={12} className="text-violet-400" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Agency filter */}
      <div className="p-3 border-t border-surface-border">
        <AgencyFilter />
      </div>
    </aside>
  )
}
