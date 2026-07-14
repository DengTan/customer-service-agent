-- ============================================
-- RLS Policies for llm_models table
-- ============================================

-- Enable RLS (already enabled based on check)
ALTER TABLE llm_models ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read all models
CREATE POLICY "Authenticated users can read models"
ON llm_models
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to insert models
CREATE POLICY "Authenticated users can insert models"
ON llm_models
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update models
CREATE POLICY "Authenticated users can update models"
ON llm_models
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy: Allow authenticated users to delete models
CREATE POLICY "Authenticated users can delete models"
ON llm_models
FOR DELETE
TO authenticated
USING (true);

-- Also enable RLS on llm_providers and add policies for consistency
ALTER TABLE llm_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read providers"
ON llm_providers
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert providers"
ON llm_providers
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update providers"
ON llm_providers
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete providers"
ON llm_providers
FOR DELETE
TO authenticated
USING (true);
