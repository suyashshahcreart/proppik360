# Media Library — Implementation Guide

For **React 18 · React Router DOM v6 · Bootstrap 5 · Vite · TypeScript · Hono · Zod · Cloudflare Workers (R2)**.

BrokerX (Laravel) is the **behavior reference**: feature-scoped S3/FTP uploads plus stub `media_*` permissions — **no shared media library**. This doc defines how to build the same capability (and a real library) on your stack.

Related: [`docs/rbac.md`](./rbac.md).

---

## 1. Goal

| You want | Do this |
|----------|---------|
| Match BrokerX behavior | Port **5 upload surfaces** to R2 + Hono |
| Make “Media Library” real | Add `media` + `media_links` + React System UI |
| Auth | Reuse RBAC names: `media_view`, `media_upload`, `media_delete` |

### Stack mapping

| BrokerX | Your project |
|---------|--------------|
| Laravel + Blade | React 18 SPA (Vite `:5173`) + Bootstrap 5 |
| Controllers / FormRequest | Hono routes + Zod |
| S3 / public disk | Cloudflare **R2** |
| FTP publish | Separate Worker/cron job (not media core) |
| No Spatie Media Library | Your tables + `requirePermission()` |
| Dropzone JS | React Dropzone / native input + resumable upload |

---

## 2. Architecture

```
React (Vite)
  → Auth context: permissions[] + can('media_upload')
  → Pages: /system/media | feature forms with uploader/picker
  → API: Hono on Cloudflare Workers
       → Zod validate
       → requirePermission('media_*')
       → R2 put/get/delete
       → D1/Postgres: media + media_links (+ entity columns if needed)
```

**Rule:** always store **object key** in DB; build public/signed URL in Hono at read time (avoid BrokerX path-vs-full-URL inconsistency).

---

## 3. What BrokerX actually does (reference)

BrokerX does **not** have:

- Spatie Media Library / `HasMedia`
- A `media` table or polymorphic attach API
- Admin Media Library CRUD screens

BrokerX **does** have:

1. Tour ZIP pipeline (Dropzone + chunked upload → S3 + FTP)
2. Sidebar/info media (URL **or** file → S3 + JSON on tour)
3. Customer profile/cover/SEO images (S3)
4. Broker profile/cover (`public` disk)
5. Settings logos (S3)
6. Stub RBAC: `media_view`, `media_upload`, `media_delete` (seeded; almost unused)
7. Dead nav link “Media Library” → `href="#"` (frontend only)

When porting: either implement the stubbed library for real, or port the five surfaces and wire `media_*` only when the library ships.

---

## 4. Data model (recommended)

```sql
media (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,      -- R2 object key
  disk TEXT NOT NULL DEFAULT 'r2',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT,
  original_name TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);

media_links (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id),
  entity_type TEXT NOT NULL,     -- 'tour' | 'customer' | 'broker' | 'setting'
  entity_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  meta_json TEXT                 -- fileName, alt, slot, etc.
);
```

### Collections

```
tour_assets | tour_info | tour_thumbnail | tour_logo
customer_profile | customer_cover | customer_seo
broker_profile | broker_cover
settings_brand
```

**Optional shortcut:** keep BrokerX-style columns on entities for a single field (`tour_thumbnail_key`) while library rows back multi-file collections.

---

## 5. R2 key layout (BrokerX-compatible)

| Key prefix | Use |
|------------|-----|
| `tours/{qr}/` | Tour package root |
| `tours/{qr}/info/` | Sidebar / info modal |
| `tours/{qr}/assets/` | Logos, attachments |
| `tours/{qr}/assets/attachments/` | Attachment files |
| `settings/tour_thumbnails/` | Thumbnails |
| `settings/tour-bottommark/` | Brand logo |
| `settings/customer/{id}/Files` | Profile / cover |
| `settings/customer/{id}/Seo` | SEO images |
| `brokers/profiles/` · `brokers/covers/` | Broker images |
| `uploads/tmp/{uploadId}/` | Chunk staging |

Sidebar media object shape (keep if published tours expect it):

```ts
{ url: 'info/filename.ext', fileName: 'Original Name.ext' }
```

Relative `url` values often omit the `tours/{qr}/` prefix and are resolved at read time.

---

## 6. Zod schemas (Worker)

```ts
import { z } from 'zod';

export const MediaCollection = z.enum([
  'tour_assets',
  'tour_info',
  'tour_thumbnail',
  'tour_logo',
  'customer_profile',
  'customer_cover',
  'customer_seo',
  'broker_profile',
  'broker_cover',
  'settings_brand',
]);

export const MediaUploadMeta = z.object({
  collection: MediaCollection,
  entityType: z.enum(['tour', 'customer', 'broker', 'setting']).optional(),
  entityId: z.string().optional(),
  originalName: z.string().max(255).optional(),
});

/** Sidebar: URL XOR upload XOR library (BrokerX URL/file + improvement) */
export const SidebarMediaSource = z.discriminatedUnion('source', [
  z.object({ source: z.literal('url'), url: z.string().url() }),
  z.object({ source: z.literal('upload') }), // file in multipart
  z.object({ source: z.literal('existing'), mediaId: z.string() }),
]);

export const ImageRules = {
  customerPhoto: {
    maxBytes: 2 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/gif'],
  },
  customerCover: {
    maxBytes: 4 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/gif'],
  },
  tourThumbnail: {
    maxBytes: 5 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  sidebarLogo: {
    maxBytes: 5 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  sidebarImage: {
    maxBytes: 10 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  sidebarVideo: {
    maxBytes: 100 * 1024 * 1024,
    mime: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'],
  },
  sidebarDoc: {
    maxBytes: 10 * 1024 * 1024,
    mime: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
  },
  settingsBrand: {
    maxBytes: 5 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
  brokerImage: {
    maxBytes: 2 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/gif'],
  },
  tourZip: {
    maxBytes: 10 * 1024 * 1024 * 1024,
    mime: ['application/zip', 'application/x-zip-compressed'],
  },
  zipChunkThreshold: 30 * 1024 * 1024, // match BrokerX ~30MB
};
```

---

## 7. Hono API surface

```
GET    /api/admin/media              media_view     list / filter
GET    /api/admin/media/:id          media_view     detail + url
POST   /api/admin/media              media_upload   single upload → R2 + row
DELETE /api/admin/media/:id          media_delete   R2 + unlink + delete row
POST   /api/admin/media/:id/link     media_upload   attach to entity
DELETE /api/admin/media-links/:id    media_delete   detach (optional keep file)

# Feature parity (BrokerX)
POST   /api/admin/tours/:id/zip
POST   /api/admin/tours/:id/zip/init|chunk|finalize
PUT    /api/admin/tours/:id/sidebar-media
POST   /api/admin/customers/:id/images
POST   /api/admin/settings/brand-logo
POST   /api/admin/brokers/:id/images
```

### Middleware & R2 helpers

```ts
function requirePermission(name: string) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user');
    const perms = await getUserPermissionNames(user.id);
    if (!perms.has(name)) return c.json({ error: 'Forbidden' }, 403);
    await next();
  };
}

async function putR2(env: Env, key: string, body: ArrayBuffer, mime: string) {
  await env.R2.put(key, body, { httpMetadata: { contentType: mime } });
}

function publicUrl(key: string) {
  return `${PUBLIC_R2_BASE}/${key}`; // or Worker-signed URL
}
```

### Library upload flow

```
multipart + MediaUploadMeta
  → Zod + mime/size check
  → requirePermission('media_upload')
  → key = buildKey(collection, entity…)
  → R2.put
  → INSERT media
  → optional INSERT media_links
  → return { id, key, url, mime, size }
```

### Delete / orphan policy

When unlinking: if no remaining `media_links` for that `media_id`, delete the R2 object and `media` row (fixes BrokerX sidebar orphan risk).

---

## 8. React UI (Bootstrap 5 — System section)

Mirror RBAC System UX: breadcrumb Home → System → Media, soft buttons (`btn-soft-*`), panel card, permission-gated nav.

### Routes (React Router v6)

```
/system/media        → MediaLibraryPage    (media_view)
/system/media/:id    → MediaDetailPage     (media_view)
```

Nav:

```tsx
{can('media_view') && <NavLink to="/system/media">Media Library</NavLink>}
```

### A. Media Library index

- Grid/list of thumbnails (images) / icons (video/doc/zip)
- Filters: collection, mime, search by original name
- Upload button if `can('media_upload')`
- Delete if `can('media_delete')`
- Soft badges for collection name

### B. Shared uploader (reuse on every feature form)

```tsx
<MediaUploader
  collection="customer_profile"
  entityType="customer"
  entityId={id}
  accept="image/*"
  maxBytes={2_097_152}
  onUploaded={(media) => {
    /* set form field to media.key or media.id */
  }}
/>
```

- Bootstrap progress bar
- Client preview via `URL.createObjectURL`
- Large ZIP: chunked/resumable when `size > zipChunkThreshold` (30MB)

### C. Media picker modal

Attach existing library items (better than BrokerX’s non-existent folder browser):

- Modal: search → select → returns `mediaId` / resolved URL
- Fits `SidebarMediaSource` `existing` branch

### D. Sidebar media field (port BrokerX UX)

1. Source radios: **URL** | **Upload** | **From library**
2. Mutual exclusion (clear others when one is chosen)
3. Preview strip + Remove
4. Submit discriminated payload to Hono

### E. Feature forms (parity with BrokerX)

| Screen | Component pattern |
|--------|-------------------|
| Tour manager | Dropzone ZIP + progress + chunk |
| Tour / booking sidebar | URL XOR upload XOR library |
| Customer edit | Profile/cover + preview |
| Settings | Brand logo |
| Broker edit | Profile/cover |

---

## 9. Permissions

| Permission | UI / API |
|------------|----------|
| `media_view` | Library list, picker, detail |
| `media_upload` | Upload, link, feature uploads |
| `media_delete` | Delete object + row |

Feature routes may also require domain perms (`tour_manager_edit`, `customer_edit`, …) **and** `media_upload` for a strict library.

Seed `admin` with all permissions (same pattern as [`docs/rbac.md`](./rbac.md)).

---

## 10. BrokerX → your project checklist

| BrokerX surface | Your implementation |
|-----------------|---------------------|
| Stub Media Library nav | Real `/system/media` SPA page |
| Tour ZIP Dropzone | React uploader + Hono chunk API → R2 |
| Sidebar URL/file | Zod discriminated union + picker |
| Customer S3 photos | `MediaUploader` + `customer_*` collections |
| Broker public disk | Same R2 keys under `brokers/…` |
| Settings logo | `settings_brand` |
| FTP publish | Out-of-band Worker; not library |
| Column full URLs | **Don’t** — store key only |

---

## 11. BrokerX validation reference (encode in Zod)

| Context | Rules |
|---------|-------|
| Tour ZIP | ZIP; large max; chunk above ~30MB |
| Tour thumbnail | image, max 5 MB |
| Sidebar logo | image, max 5 MB |
| Sidebar video | max ~100 MB; mp4/mov/webm/… |
| Sidebar document | max 10 MB; pdf/office/txt |
| Sidebar images | image, max 10 MB each |
| Customer photos (admin) | image, max 2 MB |
| Customer API cover | max 4 MB |
| Broker images | jpeg/png/gif max 2 MB |
| Settings brand | jpg/png/gif/webp max 5 MB |

---

## 12. Build order

1. R2 binding + `put` / `delete` / `url` helpers in Worker  
2. Zod upload rules + `requirePermission('media_*')`  
3. Tables `media` / `media_links`  
4. React `AuthProvider.can` + `/system/media` CRUD UI  
5. Shared `<MediaUploader>` + `<MediaPickerModal>`  
6. Port tour ZIP + sidebar field  
7. Port customer / settings / broker  
8. Optional: backfill old keys into `media` rows  

---

## 13. What not to copy from BrokerX

1. No shared media entity → can’t reuse files → **use `media_links`**  
2. Path vs full-URL mix → **key only**  
3. Orphan S3 files when clearing sidebar → **refcount delete**  
4. Unused `media_*` → **wire middleware + UI from day one**  
5. Dual logo path schemes → **one key layout**  
6. Hardcoded FTP secrets in config → **env/secrets only**  
7. Booking “media” as photo/video **counts only** — not a file store  

---

## 14. BrokerX source map (reference only)

```
config/filesystems.php
config/tour.php
database/seeders/PermissionsRolesSeeder.php          # media_*
app/Support/SidebarConfigHelper.php
app/Http/Controllers/Admin/TourManagerController.php
app/Http/Controllers/Admin/Api/TourManagerController.php
app/Http/Controllers/Admin/TourController.php
app/Http/Controllers/Admin/CustomerController.php
app/Http/Controllers/Api/CustomerProfileController.php
app/Http/Controllers/BrokerController.php
app/Http/Controllers/Admin/SettingController.php
app/Jobs/ProcessTourZipFile.php
app/Jobs/UploadTourAssetsToS3.php
resources/js/pages/tour-manager-edit.js
resources/js/pages/booking-sidebar-config-tab.js
resources/views/admin/tour-manager/edit.blade.php
resources/views/admin/bookings/partials/sidebar-config-media-action-fields.blade.php
resources/views/frontend/layouts/partials/main-nav.blade.php
docs/rbac.md
```

---

## Bottom line

BrokerX media is **feature-scoped uploads**, not a library. On **React + Hono + R2**, implement a real library with `media` / `media_links`, Zod validation, Bootstrap System UI, and `can('media_*')` — then plug the same uploader into tour, customer, broker, and settings forms. Keep R2 keys compatible with `tours/{qr}/…` if published tours must stay interchangeable.
