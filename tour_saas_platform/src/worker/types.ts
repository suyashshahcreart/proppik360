// ============================================================
// Shared types for the Cloudflare Worker
// ============================================================

/**
 * Cloudflare Worker environment bindings and variables.
 *
 * Runtime bindings — populated from .env in Node (src/server/env.ts).
 * Secrets (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are set with:
 *   npx wrangler secret put <NAME>
 * Non-secret vars come from .env (see .env.example).
 */
export interface Env {
  // ── Cloudflare Bindings ──────────────────────────────────
  /** D1 SQLite database. Use env.DB.prepare(...) for queries. */
  DB: D1Database

  /** R2 object storage bucket. Used for metadata operations. */
  TOUR_BUCKET: R2Bucket

  /**
   * Optional R2 bucket for tour_admin (and future) artifact packages.
   * When unset, admin ingest returns 503 until configured.
   */
  ADMIN_BUCKET?: R2Bucket

  // ── Secrets (wrangler secret put) ────────────────────────
  /** R2 API token key — used to sign presigned part URLs. */
  R2_ACCESS_KEY_ID: string

  /** R2 API token secret — used to sign presigned part URLs. */
  R2_SECRET_ACCESS_KEY: string

  // ── Vars (.env) ─────────────────────────────────────────
  ENVIRONMENT: 'development' | 'production'
  APP_URL: string

  /** Allowed CORS origin for /api/* requests. */
  CORS_ORIGIN: string

  /** Cloudflare Account ID — used to build the R2 S3 endpoint URL. */
  R2_ACCOUNT_ID: string

  /** R2 bucket name — must match your Cloudflare R2 bucket. */
  R2_BUCKET_NAME: string

  /** Separate R2 bucket for tour admin ZIP packages. */
  R2_ADMIN_BUCKET_NAME?: string

  /** Public hostname for admin package links (custom domain; no protocol). */
  R2_ADMIN_PUBLIC_DOMAIN?: string

  /** Multipart upload part size in bytes. Stored as string, parsed in code. */
  PART_SIZE_BYTES: string

  /** Number of concurrent part uploads in the browser. */
  UPLOAD_CONCURRENCY: string

  /** Max retries per part on failure. */
  MAX_RETRIES: string

  /** Shared secret used to authenticate calls between Worker and Go processor. */
  PROCESSOR_SECRET: string

  /** HTTP URL of the Go processor's /jobs endpoint. */
  PROCESSOR_WEBHOOK_URL: string

  /**
   * Optional base URL for Go ingest (no trailing path).
   * When unset, derived from PROCESSOR_WEBHOOK_URL by stripping /jobs.
   */
  PROCESSOR_INGEST_URL?: string

  /** Public hostname for tour viewer links (custom domain or r2.dev). */
  R2_PUBLIC_DOMAIN: string

  /** MSG91 auth key — never store in settings DB. Optional until OTP is used. */
  MSG91_AUTH_KEY?: string

  /** Optional shared secret for /api/tour-admin/* partner calls. */
  TOUR_ADMIN_API_KEY?: string

  /** Comma-separated extra CORS origins allowed on /api/tour-admin/* */
  TOUR_ADMIN_CORS_ORIGINS?: string

  /** Cloudflare API token with Zone Cache Purge (server-only secret). */
  CLOUDFLARE_API_TOKEN?: string

  /** Cloudflare zone ID for R2_PUBLIC_DOMAIN (e.g. proppik360.com). */
  CLOUDFLARE_ZONE_ID?: string

  /** Optional separate zone when R2_ADMIN_PUBLIC_DOMAIN is on another zone. */
  CLOUDFLARE_ADMIN_ZONE_ID?: string
}

/**
 * Values injected into the Hono context by authMiddleware.
 * Access with c.get('user') and c.get('sessionId') in protected routes.
 * userRoles / userPermissions are populated by authMiddleware after session validation.
 */
export interface Variables {
  user: User
  sessionId: string
  userRoles: string[]
  userPermissions: Set<string>
  tourAdminId?: string
  tourAdminTourId?: string
}

// ── Database row types ───────────────────────────────────────

export interface User {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  user_id: string
  expires_at: string
  created_at: string
}

export interface Tour {
  /** Internal auto-increment primary key (DB only). */
  id: number
  /** Public 6-digit id — R2 folder, URLs, API routes (not the QR code). */
  tour_id: string
  name: string
  owner_id: string
  original_filename: string | null
  file_size: number | null
  r2_key: string | null
  upload_id: string | null
  /** Active Go-first ingest session, when one is open. */
  upload_session_id: string | null
  status: TourStatus
  viewer_url: string | null
  processing_error: string | null
  processed_at: string | null
  /** Set when published assets are live (backup may still be pending). */
  ready_at: string | null
  backup_completed_at: string | null
  cleanup_completed_at: string | null
  /** 1 = user requested backup ZIP to R2 for this upload (default 0). */
  save_backup_zip: number | boolean
  /** ISO 8601 UTC timestamp when the Worker set status=processing */
  processing_started_at: string | null
  /** Total files the Go processor will upload to R2 */
  progress_total_files: number | null
  /** Files the Go processor has uploaded so far */
  progress_current_files: number | null
  /** Total uncompressed bytes to upload to R2 */
  progress_total_bytes: number | null
  /** Bytes uploaded to R2 so far */
  progress_current_bytes: number | null
  /**
   * Current Go processor pipeline stage:
   * Go-first: ingesting | extracting | publishing | ready_pending_backup |
   * backing_up | cleanup | completed
   * Legacy: queued | downloading | extracting | uploading_assets | finalizing
   */
  processing_stage: string | null
  customer_id: string | null
  listing_status: ListingStatus
  payment_status: PaymentStatus | null
  owner_type: OwnerType | null
  owner_type_details: string | null
  property_category_id: string | null
  property_sub_category_id: string | null
  furnish_type: FurnishType | null
  size_bhk: SizeBhk | null
  other_option_details: string | null
  super_built_up_area: number | null
  price: number | null
  use_company_billing: number
  billing_company_name: string | null
  gst_no: string | null
  house_no: string | null
  building_name: string | null
  society_name: string | null
  area_locality: string | null
  landmark: string | null
  pin_code: string | null
  country: string | null
  state: string | null
  city: string | null
  full_address: string | null
  qr_code: string | null
  created_at: string
  updated_at: string
}

export type ListingStatus = 'confirmed' | 'pending' | 'cancelled' | 'on_hold'

export type PaymentStatus =
  | 'paid'
  | 'unpaid'
  | 'free'
  | 'pending'
  | 'failed'
  | 'refunded'
  | 'partial'

export type OwnerType = 'owner' | 'broker' | 'other'

export type FurnishType = 'fully_furnished' | 'semi_furnished' | 'unfurnished'

export type SizeBhk =
  | '1_bhk'
  | '1_rk'
  | '1_5_bhk'
  | '2_bhk'
  | '2_5_bhk'
  | '3_bhk'
  | '3_5_bhk'
  | '4_bhk'
  | '4_5_bhk'
  | '5_bhk'
  | '5_plus_bhk'

/** R2 ZIP presence — attached by GET /tours and GET /tours/:id */
export interface TourZipStateFields {
  zipOnR2: boolean
  zipSize: number | null
  zipLastModified: string | null
  uploadComplete: boolean
  canResumeProcessing: boolean
}

export type TourWithZipState = Tour & TourZipStateFields

export type TourStatus =
  | 'draft'
  | 'uploading'
  | 'ingesting'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'completed'
  | 'failed'
  | 'archived'

export interface Customer {
  id: string
  owner_id: string
  first_name: string
  last_name: string
  email: string
  country_code: string
  mobile: string
  company_name: string | null
  slug: string | null
  company_website: string | null
  tag_line: string | null
  designation: string | null
  profile_photo_key: string | null
  cover_photo_key: string | null
  profile_photo_url: string | null
  cover_photo_url: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CustomerSocialLink {
  id: string
  customer_id: string
  platform_name: string
  url: string
  icon_class: string
  sort_order: number
  created_at: string
}

export interface CustomerWithLinks extends Customer {
  social_links: CustomerSocialLink[]
}

// ── RBAC types ───────────────────────────────────────────────

export interface Permission {
  id: string
  name: string
  guard_name: string
  created_at: string
  updated_at: string
}

export interface PermissionWithRoleCount extends Permission {
  roles_count: number
}

export interface Role {
  id: string
  name: string
  guard_name: string
  created_at: string
  updated_at: string
}

export interface RoleWithDetails extends Role {
  permission_names: string[]
  permission_ids: string[]
  users_count: number
}

export interface ActivityLog {
  id: string
  actor_user_id: string | null
  action: string
  subject_type: string
  subject_id: string | null
  properties_json: string | null
  created_at: string
}

// ── Media Library types ───────────────────────────────────────

export type MediaCollection =
  | 'tour_thumbnail'
  | 'tour_logo'
  | 'tour_assets'
  | 'customer_profile'
  | 'customer_cover'
  | 'customer_seo'

export type MediaEntityType = 'tour' | 'customer'

export interface Media {
  id: string
  key: string
  disk: string
  mime: string
  size: number
  checksum: string | null
  original_name: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MediaLink {
  id: string
  media_id: string
  entity_type: MediaEntityType
  entity_id: string
  collection: MediaCollection
  sort: number
  meta_json: string | null
  created_at: string
}

export interface MediaListItem extends Media {
  url: string
  links: MediaLink[]
}
