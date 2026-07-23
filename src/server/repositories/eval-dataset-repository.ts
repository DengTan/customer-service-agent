import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface GoldCitation {
  type: 'knowledge' | 'product' | 'size_chart';
  id?: string;
  chunk_id?: string;
  name: string;
  category: string;
  score: number;
}

export interface EvalDatasetVersionRow {
  id: string;
  version: number;
  status: 'draft' | 'golden' | 'archived';
  rubric: Record<string, unknown>;
  bot_ids: string[];
  turn_count: number;
  composite_score_target: number | null;
  created_by: string | null;
  created_at: string;
  frozen_at: string | null;
}

export interface EvalDatasetTurnRow {
  id: string;
  eval_dataset_version_id: string;
  turn_index: number;
  input_user_message: string;
  input_user_message_digest: string;
  input_recent_messages: Array<{ role: string; content: string }>;
  input_bot_id: string | null;
  input_shop_id: string | null;
  gold_gate_decision: 'skip' | 'retrieve' | 'clarify';
  gold_citations: GoldCitation[];
  gold_answer: string;
  gold_answer_alt: string[];
  gold_answer_facts: string[];
  gold_no_support_topics: string[];
  gold_should_handoff: boolean;
  gold_should_auto_reply: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
  source_conversation_id: string | null;
  source_simulation_id: string | null;
  source_message_id: string | null;
  provenance: 'synthetic' | 'human_labeled' | 'sampled_real';
  annotator_id: string | null;
  approved_by: string | null;
  created_at: string;
}

export class EvalDatasetRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // ---------------------------------------------------------------------------
  // Version methods
  // ---------------------------------------------------------------------------

  async createVersion(input: {
    versionLabel: string;
    rubric?: Record<string, unknown>;
    botIds?: string[];
    createdBy?: string;
  }): Promise<EvalDatasetVersionRow> {
    if (isDemoMode()) {
      const now = new Date().toISOString();
      return {
        id: 'demo-version-' + Date.now(),
        version: parseInt(String(Date.now()).slice(-4), 10),
        status: 'draft',
        rubric: input.rubric ?? {},
        bot_ids: input.botIds ?? [],
        turn_count: 0,
        composite_score_target: null,
        created_by: input.createdBy ?? null,
        created_at: now,
        frozen_at: null,
      };
    }

    // Derive next version number from existing rows
    const { data: existing, error: countErr } = await this.client
      .from('eval_dataset_versions')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (countErr) {
      throw new RepositoryError('get latest eval dataset version', countErr.message, countErr.code);
    }

    const nextVersion = existing ? (existing.version as number) + 1 : 1;

    const { data, error } = await this.client
      .from('eval_dataset_versions')
      .insert({
        version: nextVersion,
        status: 'draft',
        rubric: input.rubric ?? {},
        bot_ids: input.botIds ?? [],
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // PostgreSQL unique constraint violation on version column
        throw new RepositoryError(
          'create eval dataset version',
          `Version number already exists: ${nextVersion}`,
          'DUPLICATE_VERSION',
        );
      }
      throw new RepositoryError('create eval dataset version', error.message, error.code);
    }

    return this.toVersionRow(data as Record<string, unknown>);
  }

  async listVersions(): Promise<EvalDatasetVersionRow[]> {
    if (isDemoMode()) return [];

    const { data, error } = await this.client
      .from('eval_dataset_versions')
      .select('*')
      .order('version', { ascending: false });

    if (error) {
      throw new RepositoryError('list eval dataset versions', error.message, error.code);
    }

    return (data ?? []).map((row) =>
      this.toVersionRow(row as Record<string, unknown>),
    );
  }

  async getVersion(id: string): Promise<EvalDatasetVersionRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('eval_dataset_versions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('get eval dataset version', error.message, error.code);
    }

    return data ? this.toVersionRow(data as Record<string, unknown>) : null;
  }

  async freezeVersion(id: string): Promise<EvalDatasetVersionRow> {
    if (isDemoMode()) {
      return {
        id,
        version: 1,
        status: 'golden',
        rubric: {},
        bot_ids: [],
        turn_count: 0,
        composite_score_target: null,
        created_by: 'demo',
        created_at: new Date().toISOString(),
        frozen_at: new Date().toISOString(),
      };
    }

    const { data, error } = await this.client
      .from('eval_dataset_versions')
      .update({ status: 'golden', frozen_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('freeze eval dataset version', error.message, error.code);
    }

    return this.toVersionRow(data as Record<string, unknown>);
  }

  async updateTurnCount(versionId: string): Promise<void> {
    if (isDemoMode()) return;

    // Count actual turns for this version
    const { count, error: countErr } = await this.client
      .from('eval_dataset_turns')
      .select('id', { count: 'exact', head: true })
      .eq('eval_dataset_version_id', versionId);

    if (countErr) {
      throw new RepositoryError('count eval dataset turns', countErr.message, countErr.code);
    }

    const { error } = await this.client
      .from('eval_dataset_versions')
      .update({ turn_count: count ?? 0 })
      .eq('id', versionId);

    if (error) {
      throw new RepositoryError('update eval dataset turn count', error.message, error.code);
    }
  }

  // ---------------------------------------------------------------------------
  // Turn methods
  // ---------------------------------------------------------------------------

  async insertTurns(
    turns: Omit<EvalDatasetTurnRow, 'id' | 'created_at'>[],
  ): Promise<number> {
    if (isDemoMode()) return turns.length;

    if (turns.length === 0) return 0;

    const records = turns.map((turn) => ({
      eval_dataset_version_id: turn.eval_dataset_version_id,
      turn_index: turn.turn_index,
      input_user_message: turn.input_user_message,
      input_user_message_digest: turn.input_user_message_digest,
      input_recent_messages: turn.input_recent_messages,
      input_bot_id: turn.input_bot_id,
      input_shop_id: turn.input_shop_id,
      gold_gate_decision: turn.gold_gate_decision,
      gold_citations: turn.gold_citations,
      gold_answer: turn.gold_answer,
      gold_answer_alt: turn.gold_answer_alt,
      gold_answer_facts: turn.gold_answer_facts,
      gold_no_support_topics: turn.gold_no_support_topics,
      gold_should_handoff: turn.gold_should_handoff,
      gold_should_auto_reply: turn.gold_should_auto_reply,
      difficulty: turn.difficulty,
      category: turn.category,
      source_conversation_id: turn.source_conversation_id,
      source_simulation_id: turn.source_simulation_id,
      source_message_id: turn.source_message_id,
      provenance: turn.provenance,
      annotator_id: turn.annotator_id,
      approved_by: turn.approved_by,
    }));

    const { error } = await this.client
      .from('eval_dataset_turns')
      .insert(records);

    if (error) {
      throw new RepositoryError('insert eval dataset turns', error.message, error.code);
    }

    return turns.length;
  }

  async listTurns(versionId: string): Promise<EvalDatasetTurnRow[]> {
    if (isDemoMode()) return [];

    const { data, error } = await this.client
      .from('eval_dataset_turns')
      .select('*')
      .eq('eval_dataset_version_id', versionId)
      .order('turn_index', { ascending: true });

    if (error) {
      throw new RepositoryError('list eval dataset turns', error.message, error.code);
    }

    return (data ?? []).map((row) =>
      this.toTurnRow(row as Record<string, unknown>),
    );
  }

  async countByCategory(versionId: string): Promise<Record<string, number>> {
    if (isDemoMode()) return {};

    const { data, error } = await this.client
      .from('eval_dataset_turns')
      .select('category')
      .eq('eval_dataset_version_id', versionId);

    if (error) {
      throw new RepositoryError('count turns by category', error.message, error.code);
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const category = String((row as Record<string, unknown>).category ?? '');
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }

  async countByDifficulty(
    versionId: string,
  ): Promise<Record<string, number>> {
    if (isDemoMode()) return {};

    const { data, error } = await this.client
      .from('eval_dataset_turns')
      .select('difficulty')
      .eq('eval_dataset_version_id', versionId);

    if (error) {
      throw new RepositoryError('count turns by difficulty', error.message, error.code);
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const difficulty = String((row as Record<string, unknown>).difficulty ?? '');
      counts[difficulty] = (counts[difficulty] ?? 0) + 1;
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // Private row mappers
  // ---------------------------------------------------------------------------

  private toVersionRow(row: Record<string, unknown>): EvalDatasetVersionRow {
    return {
      id: String(row.id ?? ''),
      version: Number(row.version ?? 0),
      status: (row.status as EvalDatasetVersionRow['status']) ?? 'draft',
      rubric: (row.rubric as Record<string, unknown>) ?? {},
      bot_ids: Array.isArray(row.bot_ids) ? (row.bot_ids as string[]) : [],
      turn_count: Number(row.turn_count ?? 0),
      composite_score_target:
        row.composite_score_target != null
          ? Number(row.composite_score_target)
          : null,
      created_by: (row.created_by as string | null) ?? null,
      created_at: String(row.created_at ?? ''),
      frozen_at: (row.frozen_at as string | null) ?? null,
    };
  }

  private toTurnRow(row: Record<string, unknown>): EvalDatasetTurnRow {
    return {
      id: String(row.id ?? ''),
      eval_dataset_version_id: String(row.eval_dataset_version_id ?? ''),
      turn_index: Number(row.turn_index ?? 0),
      input_user_message: String(row.input_user_message ?? ''),
      input_user_message_digest: String(row.input_user_message_digest ?? ''),
      input_recent_messages: Array.isArray(row.input_recent_messages)
        ? (row.input_recent_messages as Array<{ role: string; content: string }>)
        : [],
      input_bot_id: (row.input_bot_id as string | null) ?? null,
      input_shop_id: (row.input_shop_id as string | null) ?? null,
      gold_gate_decision: (row.gold_gate_decision as EvalDatasetTurnRow['gold_gate_decision']) ?? 'skip',
      gold_citations: Array.isArray(row.gold_citations)
        ? (row.gold_citations as GoldCitation[])
        : [],
      gold_answer: String(row.gold_answer ?? ''),
      gold_answer_alt: Array.isArray(row.gold_answer_alt)
        ? (row.gold_answer_alt as string[])
        : [],
      gold_answer_facts: Array.isArray(row.gold_answer_facts)
        ? (row.gold_answer_facts as string[])
        : [],
      gold_no_support_topics: Array.isArray(row.gold_no_support_topics)
        ? (row.gold_no_support_topics as string[])
        : [],
      gold_should_handoff: Boolean(row.gold_should_handoff),
      gold_should_auto_reply: Boolean(row.gold_should_auto_reply),
      difficulty: (row.difficulty as EvalDatasetTurnRow['difficulty']) ?? 'medium',
      category: String(row.category ?? ''),
      source_conversation_id: (row.source_conversation_id as string | null) ?? null,
      source_simulation_id: (row.source_simulation_id as string | null) ?? null,
      source_message_id: (row.source_message_id as string | null) ?? null,
      provenance: (row.provenance as EvalDatasetTurnRow['provenance']) ?? 'synthetic',
      annotator_id: (row.annotator_id as string | null) ?? null,
      approved_by: (row.approved_by as string | null) ?? null,
      created_at: String(row.created_at ?? ''),
    };
  }
}
