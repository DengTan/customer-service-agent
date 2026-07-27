-- Drop the redundant product_id FK column and its index from size_charts.
-- Product-to-size-chart associations are managed exclusively via the junction table size_chart_products.

-- Drop the index first (depends on the column)
DROP INDEX IF EXISTS size_charts_product_id_idx;

-- Drop the column
ALTER TABLE size_charts DROP COLUMN IF EXISTS product_id;
