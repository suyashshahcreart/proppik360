import { useLocation, useNavigate } from 'react-router-dom'
import {
  Menu,
  PanelLeft,
  LogOut,
  User as UserIcon,
  ChevronDown,
  Moon,
  Sun,
  Settings,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import type { User } from '@/types'
import { api } from '@/services/api'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useFullscreen } from '@/hooks/useFullscreen'
import { ThemeSettingsPanel } from './ThemeSettingsPanel'
import { ALL_NAV_ITEMS } from './nav-config'

interface TopbarProps {
  user: User
  onLogout: () => void
  sidebarCollapsed: boolean
  onToggleSidebarCollapsed: () => void
  onOpenMobileNav: () => void
}

function TopbarIconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-8 text-muted-foreground', className)}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function Topbar({
  user,
  onLogout,
  sidebarCollapsed,
  onToggleSidebarCollapsed,
  onOpenMobileNav,
}: TopbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { resolvedTheme, toggleTheme } = useTheme()
  const { isSupported: isFullscreenSupported, isFullscreen, toggle: toggleFullscreen } = useFullscreen()

  const currentItem = ALL_NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))
  const pageTitle = currentItem?.label ?? 'Overview'

  const handleLogout = async () => {
    try {
      await api.auth.logout()
    } catch {
      // Even if the server call fails, clear local state
    }
    onLogout()
    navigate('/login', { replace: true })
  }

  const initial = user.name.charAt(0).toUpperCase()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground md:hidden"
          onClick={onOpenMobileNav}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
        <TopbarIconButton
          label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleSidebarCollapsed}
          className="hidden md:inline-flex"
        >
          <PanelLeft className="size-4" />
        </TopbarIconButton>
        <h2 className="truncate text-sm font-semibold text-foreground">{pageTitle}</h2>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        <TopbarIconButton
          label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleTheme}
        >
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </TopbarIconButton>

        <TopbarIconButton
          label={
            !isFullscreenSupported
              ? 'Fullscreen not supported in this browser'
              : isFullscreen
                ? 'Exit fullscreen (Esc)'
                : 'Enter fullscreen'
          }
          onClick={toggleFullscreen}
          className={!isFullscreenSupported ? 'opacity-50' : undefined}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </TopbarIconButton>

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
                  <Settings className="size-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Theme settings</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-72 p-4">
            <ThemeSettingsPanel />
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary">
              <Avatar className="size-7">
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-32 truncate font-medium text-foreground sm:inline">
                {user.name}
              </span>
              <ChevronDown className="hidden size-3.5 text-muted-foreground sm:inline" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
              <span className="text-sm font-medium text-foreground">{user.name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="gap-2">
              <UserIcon className="size-4" />
              {user.roles.length > 0 ? user.roles.join(', ') : user.role}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout} className="gap-2">
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
