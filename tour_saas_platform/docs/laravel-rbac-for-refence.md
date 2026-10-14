# BrokerX Roles & Permissions (RBAC)

How role and permission management works in BrokerX (Laravel + Spatie), and how to recreate the same model and admin UI in another stack (React 18 + Hono + Zod).

---

## 1. Core idea

```
Permission  = atomic action   e.g. booking_view, role_edit
Role        = named bundle    e.g. admin, tour_manager
User        = has one+ Roles
Check       = user → roles → permissions → allow/deny
```

Access in the admin UI is **role-mediated**. Direct user↔permission assignment exists in Spatie’s schema but is **not exposed** in BrokerX admin screens.

| Concept | BrokerX (Laravel) | Port target (Hono + React) |
|--------|-------------------|----------------------------|
| Permission store | `permissions` table | Same shape in D1 / Postgres / etc. |
| Role store | `roles` table | Same |
| Role↔Permission | `role_has_permissions` | Junction table |
| User↔Role | `model_has_roles` | `user_roles` |
| Package | `spatie/laravel-permission` ^6.23 | Thin service + Zod |
| Admin UI | Blade + Bootstrap 5 | React + Bootstrap 5 (same UX) |
| API / route guard | middleware `permission:…` | Hono `requirePermission('…')` |
| Menu / buttons | `@can('…')` | React `<Can permission="…">` |

**Do not copy Spatie into Cloudflare Workers.** Copy the **data model + UI + check flow**.

---

## 2. End-to-end flow

1. **Create permission** → admin UI → saved → auto-attached to `admin` role  
2. **Create / edit role** → pick permissions in grouped checkboxes → `syncPermissions`  
3. **Create / edit user** → pick roles → `syncRoles`  
4. **Request hits admin** → `auth` + block pure `customer` → controller `permission:xxx` → Blade `@can` hides UI  

```
Create Permission  →  PermissionController::store
                      → Permission::create
                      → admin Role::givePermissionTo($permission)

Create Role        →  RoleController::store
                      → Role::create(['name' => ...])
                      → $role->syncPermissions($selectedNames)  // if role_assign_permissions

Assign Role→User   →  UserController::store/update
                      → $user->syncRoles($selectedRoleNames)    // if user_manage_roles

Check permission   →  middleware('permission:…')
                   →  $user->can('booking_view') / @can / Gate
                   →  $user->hasRole('admin') for some role-only checks
```

### Layers of checks

| Layer | BrokerX | What it does |
|-------|---------|--------------|
| Route middleware | `permission:role_view` | Blocks whole action |
| Blade | `@can('role_view')` | Hides nav / buttons |
| PHP | `$user->can(...)` / `hasRole(...)` | Extra logic |
| Special | `not.customer` | Blocks users who only have `customer` |

**No Laravel Policies.** Authorization is Spatie Gate registration + middleware + `can()` / `hasRole()`.

---

## 3. Models & config

| File | Role |
|------|------|
| `app/Models/Role.php` | Extends `Spatie\Permission\Models\Role` |
| `app/Models/Permission.php` | Extends `Spatie\Permission\Models\Permission` |
| `app/Models/User.php` | Uses `HasRoles` (+ Sanctum, Activity Log) |
| `config/permission.php` | Points Spatie at App models; teams off; cache 24h |

Guard used everywhere: **`web`**.

`Customer` (`app/Models/Customer.php`) is a separate Eloquent model with **no** `HasRoles`. Frontend “customers” who are `User` records get the Spatie `customer` role.

---

## 4. Database schema

**Migration:** `database/migrations/2025_11_06_124629_create_permission_tables.php`

| Table | Purpose |
|-------|---------|
| `permissions` | `id`, `name`, `guard_name`, timestamps; unique `(name, guard_name)` |
| `roles` | same shape |
| `model_has_permissions` | direct user↔permission (morph) — **UI does not use this** |
| `model_has_roles` | user↔role (morph) |
| `role_has_permissions` | role↔permission |

### Schema to recreate in another stack

```sql
permissions (id, name UNIQUE, guard_name, created_at, updated_at)
roles       (id, name UNIQUE, guard_name, created_at, updated_at)
role_permissions (role_id, permission_id)  -- PK both
user_roles       (user_id, role_id)        -- PK both
```

Optional (skip unless you need exceptions):

```sql
user_permissions (user_id, permission_id)
```

**Rules to keep:**

- Access via **roles only** in admin UI  
- New permission → attach to `admin` automatically  
- Role update = **replace** permission set (`sync`)  
- User update = **replace** role set (`sync`)  
- Protect delete of `admin` role and core meta-permissions  
- Don’t delete the last admin  

---

## 5. Controllers & routes

| Path | Responsibility |
|------|----------------|
| `app/Http/Controllers/Admin/RoleController.php` | Full CRUD; `syncPermissions()`; activity log; protected delete |
| `app/Http/Controllers/Admin/PermissionController.php` | Full CRUD; auto-`givePermissionTo` admin on create |
| `app/Http/Controllers/Admin/UserController.php` | User CRUD + `syncRoles()` when `user_manage_roles` |

No dedicated Permission/Role service class — logic lives in controllers.

**Middleware aliases** (`bootstrap/app.php`):

- `role` → Spatie `RoleMiddleware`
- `permission` → Spatie `PermissionMiddleware`
- `role_or_permission` → Spatie `RoleOrPermissionMiddleware`
- `not.customer` → `App\Http\Middleware\BlockCustomerRole`

**Admin routes** (`routes/web.php`): prefix `ppadmlog`, name `admin.`, middleware `web`, `auth`, `not.customer`:

- `Route::resource('permissions', …)`
- `Route::resource('roles', …)`
- `Route::resource('users', …)`

Effective URLs: `/ppadmlog/roles`, `/ppadmlog/permissions`, `/ppadmlog/users`.

No dedicated roles/permissions API. Some dashboard chart routes use `role:admin`.

### Automatic role assignment elsewhere

- Frontend signup / OTP → `assignRole('customer')`
- Photographer registration → `assignRole('photographer')`; login requires `hasRole('photographer')`
- Database seeder → `admin` for `admin@admin.com`
- Role delete fallback → leftover users reassigned to `broker` (`firstOrCreate`)

---

## 6. Permission naming convention

Pattern: **`{resource}_{action}`** in `snake_case`, guard `web`.

| Prefix | Examples |
|--------|----------|
| `permission_*` | view, create, edit, delete, assign |
| `role_*` | view, create, edit, delete, **assign_permissions** |
| `user_*` | view, create, edit, delete, **manage_roles** |
| `customer_*` | CRUD |
| `booking_*` | CRUD + schedule, update_payment_status, update_status, assign_qr, approval, manage_assignees |
| `tour_*` / `tour_manager_*` / `tour_notification_*` | view/create/edit/delete; manager view/edit |
| `setting_*` | CRUD + tab keys (booking_schedule, photographer, base_price, …) |
| `qr_*`, `qr_analytics_*`, `holiday_*`, `media_*`, `activity_*`, `photographer_visit_*` | as seeded |

UI **groups** permissions by the **first segment** before `_`:

- `booking_view` → group **Booking**
- `role_assign_permissions` → group **Role**

Keep this grouping when porting the UI — it is the main usability win.

---

## 7. Default roles (seeder)

**File:** `database/seeders/PermissionsRolesSeeder.php` (called from `DatabaseSeeder`)

| Role | Permissions |
|------|-------------|
| `admin` | **all** permissions |
| `photographer` | `photographer_visit_view/create`, `booking_view` |
| `tour_manager` | `tour_manager_view/edit`, `tour_notification_view`, `tour_view`, `booking_view`, `booking_manage_assignees` |
| `seo_manager` | created only — permissions list built but **not synced** (gap) |
| `customer` | created with **no** permissions |

Notes:

- `$defaultBrokerPermissions` is computed but never assigned; `broker` is **not** seeded (only created on role-delete fallback).
- Demo admin: `admin@admin.com` → `assignRole('admin')`.
- Nav also references some report permissions that are **not** in the seeder (inconsistency).

---

## 8. Admin UI design (clone this)

Three screens under **System** (nav gated by `@can` / `@canany`).

### Shared visual language

- Extends `admin.layouts.vertical`
- Breadcrumb: Home → System → …
- `panel-card` with collapse / fullscreen / close
- Soft Bootstrap buttons (`btn-soft-*`), Remix / Iconify icons
- Yajra DataTables (server-side AJAX)
- SweetAlert2 for delete confirmations
- HTML5 `needs-validation` + `pattern="[A-Za-z0-9_-]+"` on names

### A. Permissions

Views: `resources/views/admin/permissions/{index,create,edit}.blade.php`

- Simple table: name, guard, assigned-roles count, actions
- Form: **name only**
- Force-delete warning if still attached to roles

### B. Roles (main UX)

Views: `resources/views/admin/roles/{index,create,edit}.blade.php`  
Partials: `partials/permissions.blade.php`, `partials/actions.blade.php`

**Index**

- Columns: Name | Permission badges (max 3 + “+N more”) | Users count | Actions
- Soft info badges for permission names

**Create / Edit — permission picker**

- Role name input (letters, numbers, `_`, `-`)
- Nested card with:
  - **Select All Permissions**
  - **Collapse All / Expand All**
  - **Two columns** of collapsible groups
  - Per group: border box, group checkbox, expand/collapse, individual checkboxes
  - Indeterminate group checkbox when partially selected
- Requires `role_assign_permissions`; otherwise info alert (edit shows read-only badges)

Grouping logic (controller):

```php
$permissions->groupBy(function (Permission $permission) {
    $parts = explode('_', $permission->name, 2);
    return Str::title(str_replace('_', ' ', $parts[0] ?? 'General'));
});
```

### C. Users — role assignment

Views: `resources/views/admin/users/{create,edit}.blade.php`

- Checkbox grid of roles (`roles[]`, ~3 columns) when `user_manage_roles`
- Otherwise info alert
- Index badges via `users/partials/roles.blade.php`
- Users index hides pure-customer users

### What makes this UI good

1. Grouped permission accordion, not a flat endless list  
2. Select all / group select / indeterminate states  
3. Two-column layout on desktop  
4. Badges on list pages (+N more)  
5. Capability-gated UI — no checkboxes if you cannot assign  
6. Soft Bootstrap look  
7. Same System nav: Users / Roles / Permissions  

---

## 9. How checks are done in BrokerX

### Constructor middleware (primary)

```php
$this->middleware('permission:role_view')->only(['index', 'show']);
$this->middleware('permission:role_create')->only(['create', 'store']);
$this->middleware('permission:role_edit')->only(['edit', 'update']);
$this->middleware('permission:role_delete')->only(['destroy']);
```

Same pattern on Booking, Tour, TourManager, Holiday, Customer, Settings, etc.

### Blade

```blade
@can('role_view') ... @endcan
@canany(['user_view', 'role_view', 'permission_view']) ... @endcanany
```

### Role-only checks (coarse)

Used for photographer scoping, admin dashboard redirect, some API filters — e.g. `hasRole('admin'|'photographer')`. Prefer fine-grained `permission:*` for new features.

### Tour Manager

Permission-gated (`tour_manager_view` / `tour_manager_edit`), not a separate auth system.

---

## 10. Porting to React 18 + Hono + Zod

### Backend (Hono)

```ts
import { z } from 'zod';

const RoleCreate = z.object({
  name: z.string().min(2).regex(/^[A-Za-z0-9_-]+$/),
  permissions: z.array(z.string()).optional(),
});

function requirePermission(name: string) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user');
    const perms = await getUserPermissionNames(user.id);
    if (!perms.has(name)) return c.json({ error: 'Forbidden' }, 403);
    await next();
  };
}

// app.get('/api/admin/roles', requirePermission('role_view'), ...)
// app.post('/api/admin/roles', requirePermission('role_create'), ...)
```

Effective permissions (cache on session / JWT / KV):

```ts
async function getUserPermissionNames(userId: string): Promise<Set<string>> {
  // SELECT p.name FROM user_roles ur
  // JOIN role_permissions rp ON rp.role_id = ur.role_id
  // JOIN permissions p ON p.id = rp.permission_id
  // WHERE ur.user_id = ?
}
```

On login: put `permissions: string[]` in JWT/session, or load once and refresh when roles change.

### Frontend (React + Bootstrap 5)

```tsx
// Auth context after login
const { permissions, can } = useAuth();
can('role_view'); // permissions.includes('role_view')

// Route guard
<Protected permission="role_view"><RolesPage /></Protected>

// Nav
{can('role_view') && <NavLink to="/system/roles">Roles</NavLink>}

// Button
{can('role_create') && <Button>Add Role</Button>}
```

**Role form permission UI (parity with Blade):**

1. `GET /api/admin/permissions` → list  
2. Group by `name.split('_')[0]` → title-case  
3. Chunk groups into 2 columns  
4. Group checkbox + Select All + Collapse All  
5. Submit `{ name, permissions: string[] }`  
6. Backend sync junction rows  

**Users form:** load roles → checkboxes → `{ roleIds: [] }` → sync `user_roles`.

### Screen → API checklist

| Screen | Permission needed | API |
|--------|-------------------|-----|
| Permissions index | `permission_view` | `GET /permissions` |
| Permission create | `permission_create` | `POST /permissions` (+ grant to admin) |
| Roles index | `role_view` | `GET /roles` (with permission names + user count) |
| Role create/edit | `role_create` / `role_edit` | CRUD + sync if `role_assign_permissions` |
| Users | `user_view` … | CRUD + sync roles if `user_manage_roles` |

Seed meta-permissions first:

```
permission_*, role_*, user_*
```

including `role_assign_permissions` and `user_manage_roles`, then product permissions.

### Suggested build order

1. DB tables + seed `admin` + meta permissions  
2. Hono: auth + `getUserPermissionNames` + `requirePermission`  
3. React: `AuthProvider` + `can()` + route guards  
4. Permissions CRUD pages (simple)  
5. Roles pages with grouped permission picker  
6. Users pages with role checkboxes  
7. Wire every admin feature behind `resource_action` names  

---

## 11. Project-specific quirks

1. Admin path is `/ppadmlog`, not `/admin`.  
2. Customers blocked from admin when they have **only** the `customer` role.  
3. Users index hides pure-customer users.  
4. Protected deletes: roles `admin` & `broker`; core permission/role/user management permission names.  
5. Last-admin safeguards on user update/delete.  
6. Activity logging on role/permission/user mutations (`spatie/laravel-activitylog`).  
7. Seeder gaps: `seo_manager` / broker default perms unused; some report nav perms missing from seeder.  
8. Dual auth styles: fine-grained `permission:*` vs coarse `hasRole(...)` in places.  
9. No Policies; Gate checks come from Spatie only.  

---

## 12. Source map

```
composer.json                          (spatie/laravel-permission)
config/permission.php
bootstrap/app.php
app/Models/{User,Role,Permission}.php
app/Http/Middleware/BlockCustomerRole.php
app/Http/Controllers/Admin/{Role,Permission,User}Controller.php
database/migrations/2025_11_06_124629_create_permission_tables.php
database/seeders/PermissionsRolesSeeder.php
routes/web.php
resources/views/admin/{roles,permissions,users}/**
resources/views/admin/layouts/partials/main-nav.blade.php
```

---

## Bottom line

BrokerX is classic RBAC with a strong **grouped permission checkbox** admin UI. When porting: keep the same tables, naming (`resource_action`), sync semantics, and Bootstrap UI patterns — replace Spatie middleware / `@can` with Hono middleware + a React `can()` helper.
