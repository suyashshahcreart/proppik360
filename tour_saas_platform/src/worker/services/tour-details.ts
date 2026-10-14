// ============================================================

// Tour listing details — normalize conditional fields, QR code

// ============================================================

import type {

  FurnishType,

  ListingStatus,

  OwnerType,

  PaymentStatus,

  SizeBhk,

} from '../types'

import { getCustomerByIdForOwner } from './customers'

import { getPropertyCategory } from './property-categories'
import { generateUniqueQrCode, randomQrCode } from '../utils/qr-code'

export { generateUniqueQrCode, randomQrCode } from '../utils/qr-code'



export interface TourDetailsInput {
  name: string
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

  /** Allowed only while identity is unlocked (no ZIP uploaded yet). */
  qr_code?: string | null

  /** Generate a new unique QR code (only while identity unlocked). */
  regenerate_qr?: boolean
}



export interface NormalizedTourDetails {

  name: string

  customer_id: string

  listing_status: string

  payment_status: string

  owner_type: OwnerType

  owner_type_details: string | null

  property_category_id: string | null

  property_sub_category_id: string | null

  furnish_type: FurnishType | null

  size_bhk: SizeBhk | null

  other_option_details: string | null

  super_built_up_area: number | null

  price: number | null

  use_company_billing: boolean

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

}



function blank(value: string | null | undefined): string | null {

  const trimmed = value?.trim() ?? ''

  return trimmed.length > 0 ? trimmed : null

}



function categoryKey(name: string, slug: string | null): string {

  return (slug || name).toLowerCase().replace(/[^a-z0-9]/g, '')

}



export function isOtherCategory(name: string, slug: string | null): boolean {

  const key = categoryKey(name, slug)

  return key === 'other' || key === 'others'

}



export function isResidentialCategory(name: string, slug: string | null): boolean {

  return categoryKey(name, slug).includes('residential')

}



export function showsFurnishType(name: string, slug: string | null): boolean {

  const key = categoryKey(name, slug)

  return key.includes('commercial') || key.includes('residential')

}






/**

 * Validate customer and optional property rules. Only name + customer are required.

 */

export async function normalizeTourDetails(

  db: D1Database,

  ownerId: string,

  input: TourDetailsInput,

): Promise<NormalizedTourDetails> {

  const customer = await getCustomerByIdForOwner(db, input.customer_id, ownerId)

  if (!customer) {

    throw new Error('Selected customer was not found')

  }



  const typeId = blank(input.property_category_id)

  let propertySubCategoryId: string | null = null

  let furnishType: FurnishType | null = input.furnish_type ?? null

  let sizeBhk: SizeBhk | null = input.size_bhk ?? null

  let otherOptionDetails: string | null = blank(input.other_option_details)



  if (typeId) {

    const type = await getPropertyCategory(db, typeId)

    if (!type || type.parent_id || type.status !== 'active') {

      throw new Error('Select a valid property type')

    }



    const children = await db

      .prepare(

        `SELECT COUNT(*) AS n FROM property_categories

          WHERE parent_id = ? AND deleted_at IS NULL AND status = 'active'`,

      )

      .bind(type.id)

      .first<{ n: number }>()

    const hasChildren = (children?.n ?? 0) > 0



    let subIsOther = false

    if (hasChildren) {

      propertySubCategoryId = blank(input.property_sub_category_id)

      if (propertySubCategoryId) {

        const sub = await getPropertyCategory(db, propertySubCategoryId)

        if (!sub || sub.parent_id !== type.id || sub.status !== 'active') {

          throw new Error('Property sub type does not belong to the selected type')

        }

        subIsOther = isOtherCategory(sub.name, sub.slug)

      }

    }



    const residential = isResidentialCategory(type.name, type.slug)

    const furnishVisible = showsFurnishType(type.name, type.slug)

    const otherVisible = isOtherCategory(type.name, type.slug) && subIsOther



    furnishType = furnishVisible ? furnishType : null

    sizeBhk = residential ? sizeBhk : null

    otherOptionDetails = otherVisible ? otherOptionDetails : null

  } else {

    propertySubCategoryId = null

    furnishType = null

    sizeBhk = null

    otherOptionDetails = null

  }



  const useCompanyBilling = Boolean(input.use_company_billing)

  if (useCompanyBilling) {

    if (!blank(input.billing_company_name)) throw new Error('Company name is required')

    if (!blank(input.gst_no)) throw new Error('GST number is required')

  }



  const area =

    input.super_built_up_area != null && input.super_built_up_area > 0

      ? input.super_built_up_area

      : null

  const price = input.price != null && input.price >= 0 ? input.price : null



  return {

    name: input.name.trim(),

    customer_id: input.customer_id,

    listing_status: (input.listing_status ?? 'pending').trim(),

    payment_status: (input.payment_status ?? 'unpaid').trim(),

    owner_type: input.owner_type ?? 'owner',

    owner_type_details: input.owner_type === 'other' ? blank(input.owner_type_details) : null,

    property_category_id: typeId,

    property_sub_category_id: propertySubCategoryId,

    furnish_type: furnishType,

    size_bhk: sizeBhk,

    other_option_details: otherOptionDetails,

    super_built_up_area: area,

    price,

    use_company_billing: useCompanyBilling,

    billing_company_name: useCompanyBilling ? blank(input.billing_company_name) : null,

    gst_no: useCompanyBilling ? blank(input.gst_no) : null,

    society_name: blank(input.society_name),

    area_locality: blank(input.area_locality),

    landmark: blank(input.landmark),

    house_no: blank(input.house_no),

    building_name: blank(input.building_name),

    pin_code: blank(input.pin_code),

    country: blank(input.country),

    state: blank(input.state),

    city: blank(input.city),

    full_address: blank(input.full_address),

  }

}


