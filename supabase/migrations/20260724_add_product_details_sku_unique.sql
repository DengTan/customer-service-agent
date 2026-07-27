-- Add unique constraint on product_details.sku
-- Note: Drizzle schema already defines .unique() but the migration was never created.
ALTER TABLE product_details ADD CONSTRAINT product_details_sku_unique UNIQUE (sku);
