import { NavLink } from 'react-router-dom'
import { Aperture, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { User } from '@/types'
import { can } from '@/components/shared/PermissionGate'
import { cn } from '@/lib/utils'
import { NAV_SECTIONS } from './nav-config'

interface SidebarProps {
  user: User
  collapsed: boolean
  onToggleCollapsed: () => void
  /** When rendered inside a mobile Sheet, links close the sheet on click */
  onNavigate?: () => void
}

export function Sidebar({ user, collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className={cn('flex items-center gap-2.5 px-4 py-4', collapsed && 'justify-center px-2')}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-white">
          <Aperture className="size-4.5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">360 Tour SaaS</div>
            <div className="truncate text-[11px] leading-tight text-sidebar-muted">Platform</div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2.5 py-2">
        {NAV_SECTIONS.map((section, idx) => {
          const visibleItems = section.items.filter((item) => can(user, item.permission))
          if (visibleItems.length === 0) return null

          return (
            <div key={idx} className={cn(idx > 0 && 'mt-4')}>
              {section.title && !collapsed && (
                <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
                  {section.title}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {visibleItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                          collapsed && 'justify-center px-2',
                          isActive
                            ? 'bg-sidebar-accent text-white'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white',
                        )
                      }
                    >
                      <item.icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Collapse toggle — desktop only */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="hidden items-center gap-2 border-t border-sidebar-border px-4 py-3 text-xs font-medium text-sidebar-muted hover:text-white md:flex"
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        {!collapsed && 'Collapse'}
      </button>
    </div>
  )
}
