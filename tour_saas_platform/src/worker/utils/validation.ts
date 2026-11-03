// ============================================================
// Zod validation schemas for all API request bodies
// ============================================================
import { z } from 'zod'

// ── Auth ─────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

// ── Tours ────────────────────────────────────────────────────

const tourNameSchema = z
  .string()
  .min(1, 'Tour name is required')
  .max(255, 'Tour name must be 255 characters or less')
  .trim()

/** Optional 6-digit public tour_id on create/update before upload. */
const tourSlugSchema = z
  .union([
    z.literal(''),
    z.string().regex(/^\d{6}$/, 'Tour ID must be exactly 6 digits'),
    z.null(),
  ])
  .optional()
  .transform((value) => {
    const trimmed = (value ?? '').trim()
    return trimmed.length > 0 ? trimmed : null
  })

export const createTourSchema = z.object({
  name: tourNameSchema,
  slug: tourSlugSchema,
})

export const listingStatusSchema = z.enum(['confirmed', 'pending', 'cancelled', 'on_hold'])
export const paymentStatusSchema = z.enum([
  'paid',
  'unpaid',
  'free',
  'pending',
  'failed',
  'refunded',
  'partial',
])
export const ownerTypeSchema = z.enum(['owner', 'broker', 'other'])
export const furnishTypeSchema = z.enum(['fully_furnished', 'semi_furnished', 'unfurnished'])
export const sizeBhkSchema = z.enum([
  '1_bhk',
  '1_rk',
  '1_5_bhk',
  '2_bhk',
  '2_5_bhk',
  '3_bhk',
  '3_5_bhk',
  '4_bhk',
  '4_5_bhk',
  '5_bhk',
  '5_plus_bhk',
])

export const tourDetailsSchema = z.object({
  name: tourNameSchema,
  slug: tourSlugSchema,
  customer_id: z.string().min(1, 'Customer is required'),
  listing_status: z.string().min(1).max(50).default('pending'),
  payment_status: z.string().min(1).max(50).default('unpaid'),
  owner_type: ownerTypeSchema.default('owner'),
  owner_type_details: z.string().max(255).optional().nullable(),
  property_category_id: z.string().optional().nullable(),
  property_sub_category_id: z.string().optional().nullable(),
  furnish_type: furnishTypeSchema.optional().nullable(),
  size_bhk: sizeBhkSchema.optional().nullable(),
  other_option_details: z.string().max(2000).optional().nullable(),
  super_built_up_area: z.number().positive().optional().nullable(),
  price: z.number().min(0).optional().nullable(),
  use_company_billing: z.boolean().default(false),
  billing_company_name: z.string().max(255).optional().nullable(),
  gst_no: z.string().max(20).optional().nullable(),
  house_no: z.string().max(100).optional().nullable(),
  building_name: z.string().max(255).optional().nullable(),
  society_name: z.string().max(255).optional().nullable(),
  area_locality: z.string().max(255).optional().nullable(),
  landmark: z.string().max(255).optional().nullable(),
  pin_code: z.string().max(20).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  full_address: z.string().max(2000).optional().nullable(),
  qr_code: z
    .union([
      z.literal(''),
      z.string().regex(/^[0-9a-z]{8}$/, 'QR code must be 8 letters or digits (lowercase)'),
      z.null(),
    ])
    .optional()
    .transform((value) => {
      const trimmed = (value ?? '').trim().toLowerCase()
      return trimmed.length > 0 ? trimmed : null
    }),
  regenerate_qr: z.boolean().optional().default(false),
})

// ── Upload ───────────────────────────────────────────────────

export const initiateUploadSchema = z.object({
  filename: z
    .string()
    .min(1, 'Filename is required')
    .regex(/\.zip$/i, 'Only ZIP files are allowed'),
  fileSize: z
    .number()
    .int('File size must be an integer')
    .positive('File size must be positive')
    // 10 GB maximum — adjust if needed
    .max(10 * 1024 * 1024 * 1024, 'File size must be 10 GB or less'),
  /** Replace an existing finalized ZIP in R2 (default: skip re-upload when ZIP exists). */
  forceReupload: z.boolean().optional(),
  /** When true, store a timestamped copy under {tourId}/backup_zip/ after publish. */
  saveBackupZip: z.boolean().optional().default(false),
})

export const partUrlSchema = z.object({
  partNumber: z
    .number()
    .int('Part number must be an integer')
    .min(1, 'Part number must be at least 1')
    .max(10000, 'Part number cannot exceed 10,000'),
  uploadId: z.string().min(1, 'Upload ID is required'),
})

export const completeUploadSchema = z.object({
  uploadId: z.string().min(1, 'Upload ID is required'),
  parts: z
    .array(
      z.object({
        PartNumber: z
          .number()
          .int()
          .min(1)
          .max(10000),
        ETag: z.string().min(1, 'ETag is required'),
      }),
    )
    .min(1, 'At least one part is required'),
})

export const abortUploadSchema = z.object({
  uploadId: z.string().min(1, 'Upload ID is required'),
})

export const listPartsSchema = z.object({
  uploadId: z.string().min(1, 'Upload ID is required'),
})

// ─── Customers ───────────────────────────────────────────────────────────────

const socialLinkSchema = z.object({
  platform_name: z.string().max(100, 'Platform name must be 100 characters or less').optional().default(''),
  url: z.string().max(2048, 'URL must be 2048 characters or less').optional().default(''),
  icon_class: z.string().max(200, 'Icon class must be 200 characters or less').optional().default(''),
})

// ─── RBAC ────────────────────────────────────────────────────────────────────

const rbacNameSchema = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must be 100 characters or less')
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Name must contain only letters, numbers, underscores, and hyphens',
  )

export const createPermissionSchema = z.object({
  name: rbacNameSchema,
})

export const createRoleSchema = z.object({
  name: rbacNameSchema,
  permission_ids: z.array(z.string()).optional().default([]),
})

export const createAdminUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).trim(),
  email: z.string().email('Invalid email address').max(255).trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  status: z.enum(['active', 'suspended']).optional().default('active'),
  role_ids: z.array(z.string()).optional().default([]),
})

export const updateAdminUserSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  email: z.string().email().max(255).trim().optional(),
  password: z.string().min(8).optional().or(z.literal('')).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  role_ids: z.array(z.string()).optional(),
})

// ─── Media Library ───────────────────────────────────────────────────────────

export const mediaCollectionSchema = z.enum([
  'tour_thumbnail',
  'tour_logo',
  'tour_assets',
  'customer_profile',
  'customer_cover',
  'customer_seo',
])

export type MediaCollection = z.infer<typeof mediaCollectionSchema>

// Per-collection validation rules (mirrors docs/laravel-media-library-for-refence.md §11)
export const COLLECTION_RULES: Record<
  MediaCollection,
  { maxBytes: number; allowedMimes: Set<string>; label: string }
> = {
  customer_profile: {
    maxBytes: 2 * 1024 * 1024,
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    label: 'Customer profile photo',
  },
  customer_cover: {
    maxBytes: 4 * 1024 * 1024,
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    label: 'Customer cover photo',
  },
  customer_seo: {
    maxBytes: 2 * 1024 * 1024,
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    label: 'Customer SEO image',
  },
  tour_thumbnail: {
    maxBytes: 5 * 1024 * 1024,
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    label: 'Tour thumbnail',
  },
  tour_logo: {
    maxBytes: 5 * 1024 * 1024,
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    label: 'Tour logo',
  },
  tour_assets: {
    maxBytes: 10 * 1024 * 1024,
    allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']),
    label: 'Tour asset',
  },
}

export const linkMediaSchema = z.object({
  entity_type: z.enum(['tour', 'customer']),
  entity_id: z.string().min(1),
  collection: mediaCollectionSchema,
  sort: z.number().int().optional().default(0),
  meta_json: z.string().optional().nullable(),
})

// ─── Customers ───────────────────────────────────────────────────────────────

export const customerBodySchema = z.object({
  first_name: z
    .string()
    .min(1, 'First name is required')
    .max(100, 'First name must be 100 characters or less')
    .trim(),
  last_name: z
    .string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be 100 characters or less')
    .trim(),
  email: z.string().email('Invalid email address').max(255).trim(),
  country_code: z
    .string()
    .min(1, 'Country code is required')
    .max(10, 'Country code must be 10 characters or less')
    .trim()
    .default('+91'),
  mobile: z
    .string()
    .min(1, 'Mobile number is required')
    .max(20, 'Mobile number must be 20 characters or less')
    .regex(/^[0-9+\-\s()]+$/, 'Mobile number contains invalid characters')
    .trim(),
  company_name: z.string().max(255).optional().nullable(),
  slug: z.string().max(60).optional().nullable(),
  company_website: z.string().max(2048).optional().nullable(),
  tag_line: z.string().max(500).optional().nullable(),
  designation: z.string().max(150).optional().nullable(),
  social_links: z.array(socialLinkSchema).max(50).optional().default([]),
})

// ─── Property classification masters ─────────────────────────

const propertyNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(150, 'Name must be 150 characters or less')
  .trim()

const propertySlugSchema = z
  .union([
    z.literal(''),
    z
      .string()
      .max(60, 'Slug must be 60 characters or less')
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens'),
    z.null(),
  ])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))

const propertyStatusSchema = z.enum(['active', 'inactive']).optional().default('active')

const propertySortOrderSchema = z
  .number()
  .int('Sort order must be an integer')
  .min(0, 'Sort order must be 0 or greater')
  .max(999999)
  .optional()
  .default(0)

const propertyIconSchema = z
  .union([z.literal(''), z.null(), z.string().max(500, 'Icon must be 500 characters or less')])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine(
    (v) =>
      !v ||
      /^(lucide:[A-Z][A-Za-z0-9]*|url:.+|custom:.+|media:[a-f0-9-]{36})$/i.test(v),
    'Icon must be lucide:Name, url:…, custom:…, or media:{uuid}',
  )

export const propertyCategoryBodySchema = z.object({
  name: propertyNameSchema,
  parent_id: z
    .union([z.string().min(1), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v)),
  slug: propertySlugSchema,
  icon: propertyIconSchema,
  status: propertyStatusSchema,
  sort_order: propertySortOrderSchema,
})

// ── Settings ─────────────────────────────────────────────────

const settingsGeneralPatchSchema = z.object({
  tab: z.literal('general'),
  support_email: z.string().max(255).optional(),
  support_phone: z.string().max(40).optional(),
  tour_admin_api_base_url: z.string().max(2048).optional(),
})

const msg91TemplateEntrySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, 'Template key must be snake_case (e.g. tour_access_otp)'),
  template_id: z.string().max(100),
})

const settingsSmsPatchSchema = z.object({
  tab: z.literal('sms'),
  sms_msg91_enabled: z.union([z.boolean(), z.literal('0'), z.literal('1'), z.number()]).optional(),
  msg91_sender_id: z.string().max(20).optional(),
  /** @deprecated Prefer msg91_templates.tour_access_otp — kept for backward compat. */
  msg91_otp_template_id: z.string().max(100).optional(),
  /** BrokerX-style list of { key, template_id }; stored as JSON map. */
  msg91_templates: z.array(msg91TemplateEntrySchema).max(50).optional(),
  msg91_timeout_ms: z.coerce.number().int().min(1000).max(120000).optional(),
  msg91_route: z.string().max(10).optional(),
  otp_length: z.coerce.number().int().min(4).max(8).optional(),
  otp_expiry_sec: z.coerce.number().int().min(60).max(900).optional(),
  msg91_mock_mode: z.union([z.boolean(), z.literal('0'), z.literal('1'), z.number()]).optional(),
})

export const settingsPatchSchema = z.discriminatedUnion('tab', [
  settingsGeneralPatchSchema,
  settingsSmsPatchSchema,
])

export const tourAdminMasterPutSchema = z.object({
  auto_create_on_tour_create: z.boolean().optional(),
  password_enabled_default: z.boolean().optional(),
  otp_enabled_default: z.boolean().optional(),
  default_username_pattern: z.string().min(1).max(80).optional(),
  password_mode: z.enum(['random', 'fixed']).optional(),
  default_password: z.string().min(6).max(128).optional().nullable(),
  default_country_code: z.string().max(10).optional(),
  default_mobile: z.string().max(20).optional().nullable(),
  is_active_default: z.boolean().optional(),
})

export const tourAdminTemplateBodySchema = z.object({
  label: z.string().min(1).max(120).trim(),
  username_pattern: z.string().min(1).max(80).trim(),
  password_mode: z.enum(['random', 'fixed']),
  password: z.string().min(6).max(128).optional().nullable(),
  country_code: z.string().max(10).optional(),
  mobile: z.string().max(20).optional().nullable(),
  password_enabled: z.boolean().optional(),
  otp_enabled: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
})

export const tourAdminPutSchema = z.object({
  id: z.string().uuid().optional(),
  username: z.string().min(1).max(80).trim(),
  password: z.string().min(6).max(128).optional().nullable(),
  country_code: z.string().max(10).optional(),
  mobile: z.string().max(20).optional().nullable(),
  password_enabled: z.boolean().optional(),
  otp_enabled: z.boolean().optional(),
  is_active: z.boolean().optional(),
})

export const tourAdminResetPasswordSchema = z.object({
  id: z.string().uuid().optional(),
  password: z.string().min(6).max(128).optional().nullable(),
})

export const tourAdminPasswordLoginSchema = z.object({
  username: z.string().min(1).max(80).trim(),
  password: z.string().min(1).max(128),
})

export const tourAdminOtpSendSchema = z.object({
  mobile: z.string().min(8).max(20).trim(),
})

export const tourAdminOtpVerifySchema = z.object({
  mobile: z.string().min(8).max(20).trim(),
  otp: z.string().min(4).max(8).trim(),
})

export const tourAdminFsMkdirSchema = z.object({
  path: z.string().min(1, 'path is required').max(512).trim(),
})

// ── CDN cache purge ───────────────────────────────────────────

export const systemCachePurgeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tours'),
    tourIds: z
      .array(z.string().min(1).max(64).trim())
      .min(1, 'Select at least one tour')
      .max(50, 'At most 50 tours per request'),
  }),
  z.object({
    type: z.literal('everything'),
    confirmPhrase: z.string(),
  }),
  z.object({
    type: z.literal('custom'),
    mode: z.enum(['url', 'hostname', 'tag', 'prefix']),
    values: z.array(z.string().min(1).max(2048)).min(1).max(100),
  }),
])
