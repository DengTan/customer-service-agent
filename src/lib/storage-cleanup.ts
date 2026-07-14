/**
 * Supabase Storage cleanup utilities
 * Handles file deletion when knowledge items are removed
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'smartassist';

/**
 * Extract storage key (path) from a Supabase Storage URL
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/smartassist/knowledge-images/xxx.jpg"
 *    → "knowledge-images/xxx.jpg"
 */
export function extractStorageKey(url: string): string | null {
  if (!url) return null;

  try {
    // Match: /storage/v1/object/public/{bucket}/{key}
    const match = url.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
    if (match) return match[1];

    // Fallback: if URL doesn't follow standard pattern, return null
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete a single file from Supabase Storage
 * Silently ignores errors (fire-and-forget)
 */
export async function deleteStorageFile(url: string): Promise<void> {
  if (!url) return;

  const key = extractStorageKey(url);
  if (!key) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([key]);
    if (error) {
      logger.api.warn('storage-delete-file-failed', { key, error: error.message });
    }
  } catch (err) {
    logger.api.warn('storage-delete-file-exception', { key, error: (err as Error).message });
  }
}

/**
 * Delete multiple files from Supabase Storage
 * Silently ignores errors (fire-and-forget)
 */
export async function deleteStorageFiles(urls: string[]): Promise<void> {
  if (!urls || urls.length === 0) return;

  const keys = urls
    .map(extractStorageKey)
    .filter((k): k is string => k !== null);

  if (keys.length === 0) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(keys);
    if (error) {
      logger.api.warn('storage-delete-files-failed', { keys, error: error.message });
    }
  } catch (err) {
    logger.api.warn('storage-delete-files-exception', { keys, error: (err as Error).message });
  }
}
