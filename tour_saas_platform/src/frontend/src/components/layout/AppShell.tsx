import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import type { User } from '@/types'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

interface AppShellProps {
  user: User
  onLogout: () => void
}

const COLLAPSE_KEY = 'sidebar-collapsed'

export function AppShell({ user, onLogout }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 md:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Sidebar user={user} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      </aside>

      {/* Mobile off-canvas sidebar */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-64 border-none bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground">
          <Sidebar
            user={user}
            collapsed={false}
            onToggleCollapsed={() => {}}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onLogout={onLogout}
          sidebarCollapsed={collapsed}
          onToggleSidebarCollapsed={() => setCollapsed((c) => !c)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div className="p-4 md:p-4">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
