import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { api } from './services/api'
import { AppShell } from './components/layout/AppShell'
import { Toaster } from './components/ui/sonner'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { ToursPage } from './pages/ToursPage'
import { TourDetailsPage } from './pages/TourDetailsPage'
import { TourViewPage } from './pages/TourViewPage'
import { UploadPage } from './pages/UploadPage'
import { CustomersPage } from './pages/CustomersPage'
import { CustomerViewPage } from './pages/CustomerViewPage'
import { SystemPermissionsPage } from './pages/SystemPermissionsPage'
import { SystemRolesPage } from './pages/SystemRolesPage'
import { SystemUsersPage } from './pages/SystemUsersPage'
import { MediaLibraryPage } from './pages/MediaLibraryPage'
import { PropertyTypesPage } from './pages/PropertyTypesPage'
import { SettingsPage } from './pages/SettingsPage'
import type { User } from './types'

/** Returns true if the user has the given permission. */
function can(user: User | null, permission: string): boolean {
  if (!user) return false
  return user.permissions.includes(permission)
}

function canAny(user: User | null, permissions: string[]): boolean {
  if (!user) return false
  return permissions.some((p) => user.permissions.includes(p))
}

/** Route guard — redirects to /dashboard if permission is absent. */
function PermissionRoute({
  user,
  permission,
  anyOf,
  children,
}: {
  user: User | null
  permission?: string
  anyOf?: string[]
  children: React.ReactNode
}) {
  if (!user) return <Navigate to="/login" replace />
  const allowed = anyOf?.length
    ? canAny(user, anyOf) || (permission ? can(user, permission) : false)
    : permission
      ? can(user, permission)
      : true
  if (!allowed) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.auth
      .me()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton expand={false} />
      <Routes>
        {/* Public route — redirect to dashboard if already logged in */}
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage onLogin={setUser} />
            )
          }
        />

        {/* Protected routes — redirect to login if not authenticated */}
        <Route
          path="/"
          element={
            user ? (
              <AppShell user={user} onLogout={() => setUser(null)} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />

          <Route
            path="dashboard"
            element={
              <PermissionRoute user={user} permission="dashboard_view">
                {user ? <DashboardPage user={user} /> : null}
              </PermissionRoute>
            }
          />

          <Route
            path="tours"
            element={
              <PermissionRoute user={user} permission="tour_view">
                {user ? <ToursPage user={user} /> : null}
              </PermissionRoute>
            }
          />

          <Route
            path="tours/new"
            element={
              <PermissionRoute user={user} permission="tour_create">
                {user ? <TourDetailsPage user={user} /> : null}
              </PermissionRoute>
            }
          />

          <Route
            path="tours/:tourId/edit"
            element={
              <PermissionRoute user={user} permission="tour_edit">
                {user ? <TourDetailsPage user={user} /> : null}
              </PermissionRoute>
            }
          />

          <Route
            path="tours/:tourId"
            element={
              <PermissionRoute user={user} permission="tour_view">
                {user ? <TourViewPage user={user} /> : null}
              </PermissionRoute>
            }
          />

          <Route
            path="upload/:tourId?"
            element={
              <PermissionRoute user={user} permission="tour_create">
                <UploadPage />
              </PermissionRoute>
            }
          />

          <Route
            path="customers"
            element={
              <PermissionRoute user={user} permission="customer_view">
                <CustomersPage />
              </PermissionRoute>
            }
          />

          <Route
            path="customers/:customerId"
            element={
              <PermissionRoute user={user} permission="customer_view">
                <CustomerViewPage />
              </PermissionRoute>
            }
          />

          {/* System admin routes */}
          <Route
            path="system/permissions"
            element={
              <PermissionRoute user={user} permission="permission_view">
                <SystemPermissionsPage />
              </PermissionRoute>
            }
          />

          <Route
            path="system/roles"
            element={
              <PermissionRoute user={user} permission="role_view">
                <SystemRolesPage />
              </PermissionRoute>
            }
          />

          <Route
            path="system/users"
            element={
              <PermissionRoute user={user} permission="user_view">
                <SystemUsersPage />
              </PermissionRoute>
            }
          />

          <Route
            path="system/settings"
            element={
              <PermissionRoute
                user={user}
                permission="setting_view"
                anyOf={[
                  'setting_view',
                  'setting_edit',
                  'setting_general',
                  'setting_sms',
                  'setting_tour_admin',
                ]}
              >
                {user ? <SettingsPage user={user} /> : null}
              </PermissionRoute>
            }
          />

          <Route
            path="system/media"
            element={
              <PermissionRoute user={user} permission="media_view">
                <MediaLibraryPage
                  canUpload={can(user, 'media_upload')}
                  canDelete={can(user, 'media_delete')}
                />
              </PermissionRoute>
            }
          />

          <Route
            path="system/property-types"
            element={
              <PermissionRoute user={user} permission="property_type_view">
                {user ? <PropertyTypesPage user={user} /> : null}
              </PermissionRoute>
            }
          />
        </Route>

        {/* Catch-all */}
        <Route
          path="*"
          element={<Navigate to={user ? '/dashboard' : '/login'} replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}
