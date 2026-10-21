// ============================================================
// Shared TypeScript types for the frontend
// These mirror the database row types from the Worker.
// ============================================================

export interface User {
  id: string
  name: string
  email: string
  /** Legacy single-role column — still returned for display */
  role: 'user' | 'admin'
  /** RBAC role names from user_roles table */
  roles: string[]
  /** Flat set of all effective permissions (union across all roles) */
  permissions: string[]
}

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

export interface Tour {
  /** Internal DB row id (auto-increment). */
  id: number
  /** Public 6-digit id — URLs, R2, QR. */
  tour_id: string
  name: string
  owner_id: string
  original_filename: string | null
  file_size: number | null
  r2_key: string | null
  upload_id: string | null
  upload_session_id?: string | null
  status: TourStatus
  viewer_url: string | null
  processing_error: string | null
  processed_at: string | null
  ready_at?: string | null
  backup_completed_at?: string | null
  /** User opted in to store backup ZIP on R2 for this upload (default off). */
  save_backup_zip?: boolean | number
  cleanup_completed_at?: string | null
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
   * Go-first: ingesting | extracting | publishing | ready_pending_backup |
   * backing_up | cleanup | completed
   * Legacy: queued | downloading | extracting | uploading_assets | finalizing
   */
  processing_stage: string | null
  created_at: string
  updated_at: string
  /** Finalized original.zip exists in R2 (from GET /tours/:id) */
  zipOnR2?: boolean
  zipSize?: number | null
  zipLastModified?: string | null
  /** Step 1 done: ZIP in R2 and no active browser multipart session */
  uploadComplete?: boolean
  /** POST /tours/:id/resume can run Go processing without re-upload */
  canResumeProcessing?: boolean
  /**
   * Slug (tour id) and QR may still be changed — only before first ZIP upload
   * / R2 viewer path exists.
   */
  canEditIdentity?: boolean
  /** Go ingest session start — used for step 1 elapsed time after refresh */
  upload_started_at?: string | null
  customer_id?: string | null
  listing_status?: ListingStatus
  payment_status?: PaymentStatus | null
  owner_type?: OwnerType | null
  owner_type_details?: string | null
  property_category_id?: string | null
  property_sub_category_id?: string | null
  furnish_type?: FurnishType | null
  size_bhk?: SizeBhk | null
  other_option_details?: string | null
  super_built_up_area?: number | null
  price?: number | null
  use_company_billing?: number | boolean
  billing_company_name?: string | null
  gst_no?: string | null
  house_no?: string | null
  building_name?: string | null
  society_name?: string | null
  area_locality?: string | null
  landmark?: string | null
  pin_code?: string | null
  country?: string | null
  state?: string | null
  city?: string | null
  full_address?: string | null
  qr_code?: string | null
}

/** One durable ZIP upload / processing attempt (survives re-uploads). */
export type TourUploadHistoryStatus = 'in_progress' | 'success' | 'failed' | 'warning'

export interface TourUploadHistoryReport {
  path: 'go_first' | 'legacy_multipart' | 'resume'
  stages: Array<{ stage: string; at: string; detail?: string }>
  progress: {
    files: { current: number; total: number }
    bytes: { current: number; total: number }
  }
  viewer_url?: string | null
  /** Admin (or other artifact) public URL after publish. */
  publish_url?: string | null
  layout?: string | null
  backup?: { key?: string | null; version?: string | null; verified?: boolean }
  warnings: string[]
  source_error?: string | null
  notes?: string[]
}

export interface TourUploadHistoryEntry {
  id: string
  tour_id: string
  upload_session_id: string | null
  attempt_number: number
  status: TourUploadHistoryStatus
  stage: string | null
  original_filename: string | null
  file_size: number | null
  backup_version: string | null
  backup_r2_key: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  created_at: string
  updated_at: string
  report: TourUploadHistoryReport
}

export type ListingStatus = 'confirmed' | 'pending' | 'cancelled' | 'on_hold'
export type PaymentStatus = 'paid' | 'unpaid' | 'free' | 'pending' | 'failed' | 'refunded' | 'partial'
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

export interface TourDetailsInput {
  name: string
  /** Preferred tour URL id on create, or while identity is still editable. */
  slug?: string | null
  customer_id: string
  listing_status?: ListingStatus | string
  payment_status?: PaymentStatus | string
  owner_type?: OwnerType
  owner_type_details?: string | null
  property_category_id?: string | null
  property_sub_category_id?: string | null
  furnish_type?: FurnishType | null
  size_bhk?: SizeBhk | null
  other_option_details?: string | null
  super_built_up_area?: number | null
  price?: number | null
  use_company_billing?: boolean
  billing_company_name?: string | null
  gst_no?: string | null
  house_no?: string | null
  building_name?: string | null
  society_name?: string | null
  area_locality?: string | null
  landmark?: string | null
  pin_code?: string | null
  country?: string | null
  state?: string | null
  city?: string | null
  full_address?: string | null
  /** Allowed only while canEditIdentity is true. */
  qr_code?: string | null
  /** Request a new unique QR (only while canEditIdentity is true). */
  regenerate_qr?: boolean
}

export interface DashboardStats {
  stats: {
    total: number
    uploading: number
    uploaded: number
    ready: number
    failed: number
  }
  recentTours: Array<{
    id: string
    name: string
    status: TourStatus
    file_size: number | null
    original_filename: string | null
    created_at: string
    updated_at: string
  }>
}

export interface Customer {
  id: string
  owner_id: string
  first_name: string
  last_name: string
  email: string
  /** e.g. "+91" — stored separately from mobile digits */
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
  deleted_at?: string | null
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

/** Response from GET /customers/:id/tours — profile + customer-scoped tour data. */
export interface CustomerToursResponse {
  customer: CustomerWithLinks
  tours: Tour[]
  stats: {
    total: number
    uploading: number
    uploaded: number
    ready: number
    failed: number
  }
}

// ── RBAC admin types ─────────────────────────────────────────

export interface Permission {
  id: string
  name: string
  guard_name: string
  roles_count: number
  created_at: string
  updated_at: string
}

export interface Role {
  id: string
  name: string
  guard_name: string
  permission_names: string[]
  permission_ids: string[]
  users_count: number
  created_at: string
  updated_at: string
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  roles: string[]
  status: 'active' | 'suspended'
  created_at: string
  updated_at: string
}

/** Flat settings map from GET /system/settings */
export type SettingsMap = Record<string, string | null>

export interface TourAdminMaster {
  id: string
  auto_create_on_tour_create: boolean
  password_enabled_default: boolean
  otp_enabled_default: boolean
  default_username_pattern: string
  password_mode: 'random' | 'fixed'
  has_fixed_password: boolean
  default_country_code: string
  default_mobile: string | null
  is_active_default: boolean
  updated_at: string
}

/** Default admin profile applied to new tours when auto-create is on. */
export interface TourAdminMasterTemplate {
  id: string
  label: string
  username_pattern: string
  password_mode: 'random' | 'fixed'
  has_fixed_password: boolean
  country_code: string
  mobile: string | null
  password_enabled: boolean
  otp_enabled: boolean
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TourAdmin {
  id: string
  tour_id: string
  username: string
  country_code: string
  mobile: string | null
  password_enabled: boolean
  otp_enabled: boolean
  is_active: boolean
  source: string
  has_password: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface TourAdminListResponse {
  admins: TourAdmin[]
  /** First admin — legacy convenience */
  admin: TourAdmin | null
}

export interface CustomerInput {
  first_name: string
  last_name: string
  email: string
  country_code: string
  mobile: string
  company_name?: string | null
  slug?: string | null
  company_website?: string | null
  tag_line?: string | null
  designation?: string | null
  social_links?: Array<{
    platform_name?: string
    url?: string
    icon_class?: string
  }>
}

// ── Media Library types ────────────────────────────────────────────────

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

export interface MediaUploadResult extends Media {
  url: string
  link_id: string | null
}

// ── Property classification masters (recursive hierarchy) ────

export type PropertyStatus = 'active' | 'inactive'

export interface PropertyCategory {
  id: string
  parent_id: string | null
  parent_name?: string
  name: string
  slug: string | null
  icon: string | null
  status: PropertyStatus
  sort_order: number
  depth: number
  children_count: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface PropertyCategoryTreeNode extends PropertyCategory {
  children: PropertyCategoryTreeNode[]
}

export interface PropertyCategoryInput {
  name: string
  parent_id?: string | null
  slug?: string | null
  icon?: string | null
  status?: PropertyStatus
  sort_order?: number
}
