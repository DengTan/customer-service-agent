import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';

/**
 * Shared AI-processing mixin for conversation repositories.
 *
 * Encapsulates the ai_processing / ai_processing_started_at mutation logic that
 * is identical across ConversationRepository and SimulationRepository, differing
 * only in the table name and in-memory demo array.
 *
 * Usage:
 * ```ts
 * class MyRepository extends AiProcessingMixin {
 *   constructor() {
 *     super('my_table', DEMO_ARRAY);
 *   }
 * }
 * ```
 */
export class AiProcessingMixin {
  private readonly tableName: string;
  private readonly demoArray: Array<{
    id: string;
    ai_processing?: boolean;
    ai_processing_started_at?: string | null;
  }>;
  private readonly loggerName: string;

  constructor(
    tableName: string,
    demoArray: Array<{
      id: string;
      ai_processing?: boolean;
      ai_processing_started_at?: string | null;
    }>,
    loggerName?: string,
  ) {
    this.tableName = tableName;
    this.demoArray = demoArray;
    this.loggerName = loggerName ?? tableName;
  }

  private getLogger() {
    // Lazy import to avoid circular dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLogger } = require('@/lib/logger');
    return getLogger(this.loggerName);
  }

  /**
   * Mark the conversation as currently being processed by the LLM.
   * Idempotent: calling it again updates ai_processing_started_at to NOW().
   */
  async markAiProcessing(conversationId: string): Promise<void> {
    if (isDemoMode()) {
      const item = this.demoArray.find(c => c.id === conversationId);
      if (item) {
        item.ai_processing = true;
        item.ai_processing_started_at = new Date().toISOString();
      }
      return;
    }

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from(this.tableName)
        .update({
          ai_processing: true,
          ai_processing_started_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (error) {
        this.getLogger().warn(`[${this.tableName}] markAiProcessing: supabase error`, {
          error,
          conversationId,
        });
      }
    } catch (err) {
      // Non-critical: failing to mark processing is OK — clearAiProcessing in the
      // finally block will still reset state if streaming gets there.
      this.getLogger().warn(`[${this.tableName}] markAiProcessing: exception`, {
        error: err,
        conversationId,
      });
    }
  }

  /**
   * Mark the conversation as no longer being processed.
   * Safe to call multiple times.
   */
  async clearAiProcessing(conversationId: string): Promise<void> {
    if (isDemoMode()) {
      const item = this.demoArray.find(c => c.id === conversationId);
      if (item) {
        item.ai_processing = false;
        item.ai_processing_started_at = null;
      }
      return;
    }

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from(this.tableName)
        .update({
          ai_processing: false,
          ai_processing_started_at: null,
        })
        .eq('id', conversationId);

      if (error) {
        this.getLogger().warn(`[${this.tableName}] clearAiProcessing: supabase error`, {
          error,
          conversationId,
        });
      }
    } catch (err) {
      this.getLogger().warn(`[${this.tableName}] clearAiProcessing: exception`, {
        error: err,
        conversationId,
      });
    }
  }
}
