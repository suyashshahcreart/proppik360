import {
  LayoutDashboard,
  Compass,
  Users,
  UploadCloud,
  Images,
  UserCog,
  ShieldCheck,
  KeyRound,
  Building2,
  Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Primary permission; if anyOf is set, either primary or anyOf grants access. */
  permission: string
  anyOf?: string[]
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, permission: 'dashboard_view' },
      { label: 'Tours', to: '/tours', icon: Compass, permission: 'tour_view' },
      { label: 'Customers', to: '/customers', icon: Users, permission: 'customer_view' },
      { label: 'Upload Tour', to: '/upload', icon: UploadCloud, permission: 'tour_create' },
      { label: 'Media Library', to: '/system/media', icon: Images, permission: 'media_view' },
    ],
  },
  {
    title: 'Masters',
    items: [
      {
        label: 'Property Categories',
        to: '/system/property-types',
        icon: Building2,
        permission: 'property_type_view',
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        label: 'Settings',
        to: '/system/settings',
        icon: Settings,
        permission: 'setting_view',
        anyOf: [
          'setting_view',
          'setting_edit',
          'setting_general',
          'setting_sms',
          'setting_tour_admin',
        ],
      },
      { label: 'Users', to: '/system/users', icon: UserCog, permission: 'user_view' },
      { label: 'Roles', to: '/system/roles', icon: ShieldCheck, permission: 'role_view' },
      { label: 'Permissions', to: '/system/permissions', icon: KeyRound, permission: 'permission_view' },
    ],
  },
]

/** Flat lookup used by the Topbar to derive the current page title. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)
