import type { ReactNode } from 'react'
import type { User } from '@/types'

export function can(user: User | null, permission: string): boolean {
  if (!user) return false
  return user.permissions.includes(permission)
}

export function canAny(user: User | null, permissions: string[]): boolean {
  if (!user) return false
  return permissions.some((p) => user.permissions.includes(p))
}

interface PermissionGateProps {
  user: User | null
  permission?: string
  anyOf?: string[]
  children: ReactNode
  fallback?: ReactNode
}

/** Conditionally renders children based on the current user's permissions. */
export function PermissionGate({ user, permission, anyOf, children, fallback = null }: PermissionGateProps) {
  const allowed = permission ? can(user, permission) : anyOf ? canAny(user, anyOf) : true
  return allowed ? <>{children}</> : <>{fallback}</>
}
