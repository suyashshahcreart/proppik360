-- ============================================================
-- Tour listing details (customer, property, billing, address, QR)
-- Migration: 0014_tour_details
--
-- Processing status (draft → completed) stays on tours.status.
-- listing_status is the business status shown on the details form.
-- ============================================================

ALTER TABLE tours ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE tours ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE tours ADD COLUMN payment_status TEXT;
ALTER TABLE tours ADD COLUMN owner_type TEXT;
ALTER TABLE tours ADD COLUMN owner_type_details TEXT;
ALTER TABLE tours ADD COLUMN property_category_id TEXT REFERENCES property_categories(id);
ALTER TABLE tours ADD COLUMN property_sub_category_id TEXT REFERENCES property_categories(id);
ALTER TABLE tours ADD COLUMN furnish_type TEXT;
ALTER TABLE tours ADD COLUMN size_bhk TEXT;
ALTER TABLE tours ADD COLUMN other_option_details TEXT;
ALTER TABLE tours ADD COLUMN super_built_up_area REAL;
ALTER TABLE tours ADD COLUMN price REAL;
ALTER TABLE tours ADD COLUMN use_company_billing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tours ADD COLUMN billing_company_name TEXT;
ALTER TABLE tours ADD COLUMN gst_no TEXT;
ALTER TABLE tours ADD COLUMN house_no TEXT;
ALTER TABLE tours ADD COLUMN building_name TEXT;
ALTER TABLE tours ADD COLUMN society_name TEXT;
ALTER TABLE tours ADD COLUMN area_locality TEXT;
ALTER TABLE tours ADD COLUMN landmark TEXT;
ALTER TABLE tours ADD COLUMN pin_code TEXT;
ALTER TABLE tours ADD COLUMN country TEXT;
ALTER TABLE tours ADD COLUMN state TEXT;
ALTER TABLE tours ADD COLUMN city TEXT;
ALTER TABLE tours ADD COLUMN full_address TEXT;
ALTER TABLE tours ADD COLUMN qr_code TEXT;

CREATE INDEX IF NOT EXISTS idx_tours_customer_id
  ON tours(customer_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tours_qr_code
  ON tours(qr_code) WHERE qr_code IS NOT NULL AND deleted_at IS NULL;
