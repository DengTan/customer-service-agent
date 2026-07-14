-- ============================================
-- RLS Policies for Knowledge Tables
-- ============================================
-- These tables have RLS enabled but are missing SELECT policies,
-- causing 403/500 errors when accessed via the anon key.

-- knowledge_chunks
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "Allow authenticated users to read knowledge_chunks"
ON knowledge_chunks FOR SELECT TO authenticated USING (true);

-- knowledge_items
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_items" ON knowledge_items;
CREATE POLICY "Allow authenticated users to read knowledge_items"
ON knowledge_items FOR SELECT TO authenticated USING (true);

-- knowledge_versions
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_versions" ON knowledge_versions;
CREATE POLICY "Allow authenticated users to read knowledge_versions"
ON knowledge_versions FOR SELECT TO authenticated USING (true);

-- knowledge_import_jobs
ALTER TABLE knowledge_import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_import_jobs" ON knowledge_import_jobs;
CREATE POLICY "Allow authenticated users to read knowledge_import_jobs"
ON knowledge_import_jobs FOR SELECT TO authenticated USING (true);

-- knowledge_feedback
ALTER TABLE knowledge_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_feedback" ON knowledge_feedback;
CREATE POLICY "Allow authenticated users to read knowledge_feedback"
ON knowledge_feedback FOR SELECT TO authenticated USING (true);

-- knowledge_gap_signals
ALTER TABLE knowledge_gap_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_gap_signals" ON knowledge_gap_signals;
CREATE POLICY "Allow authenticated users to read knowledge_gap_signals"
ON knowledge_gap_signals FOR SELECT TO authenticated USING (true);

-- knowledge_learning_queue
ALTER TABLE knowledge_learning_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read knowledge_learning_queue" ON knowledge_learning_queue;
CREATE POLICY "Allow authenticated users to read knowledge_learning_queue"
ON knowledge_learning_queue FOR SELECT TO authenticated USING (true);
