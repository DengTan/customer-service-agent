/**
 * Dataset Build Service
 * Phase 1.3 — Builds the labeled evaluation dataset from real + synthetic sources.
 *
 * Pipeline:
 *   1. sampleFromReal()   — stratified sample from simulation_evaluations @> '{gold_candidate}'
 *   2. synthesizeFromTestCases() — expand test_cases scripts × expected_outcomes
 *   3. redactPII()       — allow-list replacements on every user message
 *   4. assignGoldLabels() — run KnowledgeSearchService.search() to produce gold_citations
 *   5. build()            — orchestrate all steps, persist eval_dataset_versions + eval_dataset_turns
 */

import { createHash } from 'crypto';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { EvalDatasetRepository, type GoldCitation } from '@/server/repositories/eval-dataset-repository';
import { SimulationEvaluationRepository } from '@/server/repositories/simulation-evaluation-repository';
import { TestCaseRepository } from '@/server/repositories/test-case-repository';
import { KnowledgeSearchService, type KnowledgeSourceItem } from '@/server/services/knowledge-search-service';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A candidate turn before gold labels are assigned. */
export interface CandidateTurn {
  input_user_message: string;
  input_recent_messages: Array<{ role: string; content: string }>;
  input_bot_id: string | null;
  input_shop_id: string | null;
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
  provenance: 'synthetic' | 'sampled_real';
  annotator_id: string | null;
}

/** A fully labeled turn ready for insertion. */
export interface LabeledTurn extends CandidateTurn {
  turn_index: number;
  input_user_message_digest: string;
  gold_gate_decision: 'skip' | 'retrieve' | 'clarify';
  gold_citations: GoldCitation[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DatasetBuildService {
  /**
   * Per-category quota (easy / medium / hard) — must total >= 200.
   * These are the hard targets; shortfalls are reported, not auto-filled.
   */
  static readonly QUOTA: Record<string, { easy: number; medium: number; hard: number }> = {
    refund:    { easy: 18, medium: 12, hard: 6 },
    logistics: { easy: 14, medium: 10, hard: 4 },
    size:      { easy: 12, medium:  8, hard: 4 },
    product:   { easy: 14, medium: 10, hard: 4 },
    policy:    { easy: 10, medium:  6, hard: 4 },
    chitchat:  { easy: 12, medium:  6, hard: 2 },
    other:     { easy:  8, medium: 10, hard: 6 },
  };

  private readonly evalRepo: EvalDatasetRepository;
  private readonly simEvalRepo: SimulationEvaluationRepository;
  private readonly testCaseRepo: TestCaseRepository;
  private readonly knowledgeSearch: KnowledgeSearchService;

  constructor() {
    this.evalRepo = new EvalDatasetRepository();
    this.simEvalRepo = new SimulationEvaluationRepository();
    this.testCaseRepo = new TestCaseRepository();
    this.knowledgeSearch = new KnowledgeSearchService();
  }

  // ---------------------------------------------------------------------------
  // Public: build()
  // ---------------------------------------------------------------------------

  async build(args: {
    versionLabel: string;
    targetBotIds: string[];
    operatorId: string;
    dryRun: boolean;
  }): Promise<{
    versionId: string;
    sampled_real_count: number;
    synthetic_count: number;
    total: number;
    quota_shortfalls: Array<{ category: string; difficulty: string; needed: number; have: number }>;
  }> {
    logger.info('[DatasetBuild] Starting build', { versionLabel: args.versionLabel, dryRun: args.dryRun });

    // --- Step 1: create version row (only on real writes) ---
    const versionId = args.dryRun
      ? `dryrun-${Date.now()}`
      : (await this.evalRepo.createVersion({
          versionLabel: args.versionLabel,
          botIds: args.targetBotIds,
          createdBy: args.operatorId,
        })).id;

    // --- Step 2: sample from real ---
    const realCandidates = await this.sampleFromReal({
      targetBotIds: args.targetBotIds,
      perCategoryQuota: this.sumQuota('easy') + this.sumQuota('medium') + this.sumQuota('hard'),
    });

    // --- Step 3: synthesize from test cases ---
    const syntheticCandidates = await this.synthesizeFromTestCases({
      targetBotIds: args.targetBotIds,
      perCategoryQuota: this.sumQuota('easy') + this.sumQuota('medium') + this.sumQuota('hard'),
    });

    // --- Step 4: merge ---
    const allCandidates: CandidateTurn[] = [...realCandidates, ...syntheticCandidates];

    // --- Step 5: assign gold labels ---
    const labeled = await this.assignGoldLabels(allCandidates);

    // --- Step 6: compute shortfalls ---
    const shortfalls = this.computeShortfalls(labeled);

    if (args.dryRun) {
      logger.info('[DatasetBuild] Dry-run complete', {
        sampled_real_count: realCandidates.length,
        synthetic_count: syntheticCandidates.length,
        total: labeled.length,
        shortfalls,
      });
      return {
        versionId,
        sampled_real_count: realCandidates.length,
        synthetic_count: syntheticCandidates.length,
        total: labeled.length,
        quota_shortfalls: shortfalls,
      };
    }

    // --- Step 7: persist ---
    await this.persistLabeledTurns(versionId, labeled);
    await this.evalRepo.updateTurnCount(versionId);

    logger.info('[DatasetBuild] Build complete', {
      versionId,
      sampled_real_count: realCandidates.length,
      synthetic_count: syntheticCandidates.length,
      total: labeled.length,
    });

    return {
      versionId,
      sampled_real_count: realCandidates.length,
      synthetic_count: syntheticCandidates.length,
      total: labeled.length,
      quota_shortfalls: shortfalls,
    };
  }

  // ---------------------------------------------------------------------------
  // sampleFromReal()
  // ---------------------------------------------------------------------------

  /**
   * Stratified sample from simulation_evaluations where tags @> '{gold_candidate}'.
   *
   * Strategy:
   * - Join simulation_evaluations → simulation_messages → simulation_conversations
   * - Stratify by (category, difficulty) using metadata on the evaluation
   * - Hard-fetch via in() batches (avoids loading PII beyond the message itself)
   * - Returns CandidateTurn[] with provenance='sampled_real'
   */
  async sampleFromReal(opts: {
    targetBotIds: string[];
    perCategoryQuota: number;
  }): Promise<CandidateTurn[]> {
    if (isDemoMode()) {
      logger.debug('[DatasetBuild] Demo mode: sampleFromReal returns empty');
      return [];
    }

    const supabase = getSupabaseClient();
    const candidates: CandidateTurn[] = [];

    // Collect all gold_candidate evaluations
    const { data: evals, error: evalErr } = await supabase
      .from('simulation_evaluations')
      .select('id, simulation_id, message_id, tags, rating')
      .overlaps('tags', ['gold_candidate']);

    if (evalErr || !evals || evals.length === 0) {
      logger.debug('[DatasetBuild] No gold_candidate evaluations found', { error: evalErr?.message });
      return [];
    }

    // Collect message IDs for batch lookup
    const messageIds = evals.map((e) => e.message_id).filter(Boolean);
    if (messageIds.length === 0) return [];

    // Batch-fetch messages
    const { data: messages, error: msgErr } = await supabase
      .from('simulation_messages')
      .select('id, conversation_id, role, content, sources, created_at')
      .in('id', messageIds)
      .eq('role', 'user');

    if (msgErr || !messages || messages.length === 0) {
      logger.warn('[DatasetBuild] Failed to fetch messages for gold_candidate evaluations', { error: msgErr?.message });
      return [];
    }

    // Build conversation ID set for batch lookup
    const conversationIds = [...new Set(messages.map((m) => m.conversation_id).filter(Boolean))];
    const { data: conversations } = await supabase
      .from('simulation_conversations')
      .select('id, scenario_id, bot_id')
      .in('id', conversationIds);

    const convMap = new Map<string, { scenario_id: string | null; bot_id: string | null }>();
    for (const conv of conversations ?? []) {
      convMap.set(conv.id, { scenario_id: conv.scenario_id, bot_id: conv.bot_id });
    }

    // Map evaluations → messages
    const evalMap = new Map<string, typeof evals[0]>();
    for (const ev of evals) {
      evalMap.set(ev.message_id, ev);
    }

    // Build per-(category, difficulty) buckets
    const buckets: Record<string, CandidateTurn[]> = {};

    for (const msg of messages) {
      const eval_ = evalMap.get(msg.id);
      if (!eval_) continue;

      const conv = convMap.get(msg.conversation_id);
      if (!conv) continue;

      // Filter by target bots
      if (opts.targetBotIds.length > 0 && conv.bot_id && !opts.targetBotIds.includes(conv.bot_id)) {
        continue;
      }

      // Derive category from scenario_id or tags
      const category = this.deriveCategory(eval_.tags ?? [], conv.scenario_id ?? '');
      const difficulty = this.deriveDifficulty(eval_.rating ?? 3);

      const bucketKey = `${category}::${difficulty}`;
      if (!buckets[bucketKey]) buckets[bucketKey] = [];

      const redacted = await this.redactPII(msg.content ?? '');

      buckets[bucketKey].push({
        input_user_message: redacted.redacted,
        input_recent_messages: [], // real sampled turns don't include history (PII protection)
        input_bot_id: conv.bot_id ?? null,
        input_shop_id: null,
        gold_answer: '[sampled from real conversation — gold_answer pending label assignment]',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_no_support_topics: [],
        gold_should_handoff: false,
        gold_should_auto_reply: false,
        difficulty,
        category,
        source_conversation_id: null, // simulation_conversations, not conversations
        source_simulation_id: msg.conversation_id,
        source_message_id: msg.id,
        provenance: 'sampled_real',
        annotator_id: null,
      });
    }

    // Apply per-category quota (stratified)
    for (const [bucketKey, turns] of Object.entries(buckets)) {
      const [category, difficulty] = bucketKey.split('::') as [string, 'easy' | 'medium' | 'hard'];
      const quota = DatasetBuildService.QUOTA[category];
      if (!quota) continue;
      const limit = quota[difficulty] ?? 0;
      candidates.push(...turns.slice(0, limit));
    }

    logger.debug('[DatasetBuild] sampleFromReal done', { buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), sampled: candidates.length });
    return candidates;
  }

  // ---------------------------------------------------------------------------
  // synthesizeFromTestCases()
  // ---------------------------------------------------------------------------

  /**
   * Walk each active test case's scripts[] × expected_outcomes[] pairwise,
   * producing one CandidateTurn per pair with provenance='synthetic'.
   *
   * gold_answer = expected_response (from script)
   * gold_should_handoff = triggers_handoff (from metadata)
   * category = test_case.category
   * difficulty = 'easy' (default)
   */
  async synthesizeFromTestCases(opts: {
    targetBotIds: string[];
    perCategoryQuota: number;
  }): Promise<CandidateTurn[]> {
    const candidates: CandidateTurn[] = [];

    // Fetch active test cases excluding 'general' category
    const { items: testCases } = await this.testCaseRepo.list({
      category: null,
      status: 'active',
      limit: 500,
    });

    // Filter out 'general' category
    const nonGeneral = testCases.filter((tc) => tc.category !== 'general');

    for (const tc of nonGeneral) {
      const scripts = tc.scripts ?? [];
      const outcomes = tc.expected_outcomes ?? [];

      // Pair scripts[i] with outcomes[i] — walk pairwise
      const maxLen = Math.min(scripts.length, outcomes.length);
      for (let i = 0; i < maxLen; i++) {
        const script = scripts[i];
        const outcome = outcomes[i];

        if (!script?.user_message?.trim()) continue;

        const redacted = await this.redactPII(script.user_message);
        const metadata = tc.metadata ?? {};

        const goldShouldHandoff = this.extractTriggersHandoff(metadata);
        const goldShouldAutoReply = !goldShouldHandoff && outcome?.type === 'response_match';

        candidates.push({
          input_user_message: redacted.redacted,
          input_recent_messages: [],
          input_bot_id: null,
          input_shop_id: null,
          gold_answer: script.expected_response ?? '[synthetic — no expected_response defined]',
          gold_answer_alt: [],
          gold_answer_facts: [],
          gold_no_support_topics: [],
          gold_should_handoff: goldShouldHandoff,
          gold_should_auto_reply: goldShouldAutoReply,
          difficulty: 'easy',
          category: tc.category ?? 'other',
          source_conversation_id: null,
          source_simulation_id: null,
          source_message_id: null,
          provenance: 'synthetic',
          annotator_id: null,
        });
      }
    }

    logger.debug('[DatasetBuild] synthesizeFromTestCases done', { synthesized: candidates.length });
    return candidates;
  }

  // ---------------------------------------------------------------------------
  // redactPII()
  // ---------------------------------------------------------------------------

  /**
   * Explicit allow-list replacements:
   * - Emails               → [EMAIL]
   * - 11-digit Chinese phones → [PHONE]
   * - 32+ char hex strings → [HEX_TOKEN]
   * - Gorgias ticket IDs   → [TICKET_ID]
   *
   * Returns { redacted, detectedTags }.
   */
  async redactPII(text: string): Promise<{ redacted: string; detectedTags: string[] }> {
    const detectedTags: string[] = [];

    let redacted = text;

    // Email: anything matching name@domain
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(redacted)) {
      redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
      detectedTags.push('email');
    }

    // Chinese phone: 11 consecutive digits (common in WeChat/手机号 patterns)
    if (/\d{11}/.test(redacted)) {
      redacted = redacted.replace(/\d{11}/g, '[PHONE]');
      detectedTags.push('phone');
    }

    // Long hex token: 32+ hex chars (common in API keys, tokens)
    if (/[0-9a-fA-F]{32,}/.test(redacted)) {
      redacted = redacted.replace(/[0-9a-fA-F]{32,}/g, '[HEX_TOKEN]');
      detectedTags.push('hex_token');
    }

    // Gorgias ticket ID: numbers that look like external platform IDs (gorgias_ticket_id pattern)
    // Matches patterns like "gorgias_12345678" or standalone large numbers near ticket context
    if (/(?:gorgias[_\s]?)?ticket[_\s]?(?:id)?[:\s]*(\d{6,})/i.test(redacted)) {
      redacted = redacted.replace(/(?:gorgias[_\s]?)?ticket[_\s]?(?:id)?[:\s]*(\d{6,})/gi, '[TICKET_ID]');
      if (!detectedTags.includes('ticket_id')) detectedTags.push('ticket_id');
    }

    return { redacted, detectedTags };
  }

  // ---------------------------------------------------------------------------
  // assignGoldLabels()
  // ---------------------------------------------------------------------------

  /**
   * Run KnowledgeSearchService.search() (read-only) on each candidate to produce
   * gold_citations. Sets gold_gate_decision = 'retrieve' if sources found, else 'skip'.
   *
   * gold_answer is preserved from the candidate (pre-filled for synthetic;
   * sampled_real turns have a placeholder that will be enriched in a future pass).
   *
   * Searches are batched in chunks of 20 to avoid overwhelming the vector search service.
   */
  async assignGoldLabels(candidates: CandidateTurn[]): Promise<LabeledTurn[]> {
    const labeled: LabeledTurn[] = [];
    const CHUNK_SIZE = 20;

    // Batch concurrent searches
    const searchResults: Array<{ sources: KnowledgeSourceItem[] } | null> = new Array(candidates.length).fill(null);

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (c, chunkIdx) => {
          const globalIdx = i + chunkIdx;
          const result = await this.knowledgeSearch.search(c.input_user_message, 0.5, 5);
          return { globalIdx, result };
        }),
      );

      for (const settled of chunkResults) {
        if (settled.status === 'fulfilled') {
          searchResults[settled.value.globalIdx] = settled.value.result;
        }
      }
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const searchResult = searchResults[i];

      let gold_citations: GoldCitation[] = [];
      let gold_gate_decision: 'skip' | 'retrieve' | 'clarify' = 'skip';

      if (searchResult && searchResult.sources && searchResult.sources.length > 0) {
        gold_gate_decision = 'retrieve';
        gold_citations = searchResult.sources.map((s: KnowledgeSourceItem) => ({
          type: (s.type as GoldCitation['type']) ?? 'knowledge',
          id: s.id ?? s.knowledge_item_id,
          chunk_id: s.chunk_id ?? undefined,
          name: s.name ?? s.title ?? '',
          category: s.category ?? '',
          score: s.score ?? 0,
        }));
      } else if (searchResult === null) {
        logger.warn('[DatasetBuild] KnowledgeSearch failed for candidate', {
          index: i,
          category: c.category,
        });
      }

      // If gold_answer is still a placeholder, derive from citations or set skip
      let goldAnswer = c.gold_answer;
      if (goldAnswer.startsWith('[sampled from real')) {
        // For sampled real: use the top citation content as a proxy, or mark skip
        goldAnswer = gold_citations.length > 0
          ? gold_citations[0].name
          : '[gold_answer pending human annotation]';
      }

      // Enforce mutual exclusivity: if should_handoff, cannot also should_auto_reply
      const goldShouldAutoReply = c.gold_should_handoff ? false : c.gold_should_auto_reply;

      const turnDigest = createHash('sha256').update(c.input_user_message).digest('hex');

      labeled.push({
        ...c,
        turn_index: i,
        input_user_message_digest: turnDigest,
        gold_gate_decision,
        gold_citations,
        gold_answer: goldAnswer,
        gold_should_auto_reply: goldShouldAutoReply,
      });
    }

    return labeled;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Persist labeled turns in chunks of 50, then update turn_count.
   */
  private async persistLabeledTurns(versionId: string, turns: LabeledTurn[]): Promise<void> {
    const CHUNK = 50;
    for (let i = 0; i < turns.length; i += CHUNK) {
      const chunk = turns.slice(i, i + CHUNK);
      const records = chunk.map((t) => ({
        eval_dataset_version_id: versionId,
        turn_index: t.turn_index,
        input_user_message: t.input_user_message,
        input_user_message_digest: t.input_user_message_digest,
        input_recent_messages: t.input_recent_messages,
        input_bot_id: t.input_bot_id,
        input_shop_id: t.input_shop_id,
        gold_gate_decision: t.gold_gate_decision,
        gold_citations: t.gold_citations,
        gold_answer: t.gold_answer,
        gold_answer_alt: t.gold_answer_alt,
        gold_answer_facts: t.gold_answer_facts,
        gold_no_support_topics: t.gold_no_support_topics,
        gold_should_handoff: t.gold_should_handoff,
        gold_should_auto_reply: t.gold_should_auto_reply,
        difficulty: t.difficulty,
        category: t.category,
        source_conversation_id: t.source_conversation_id,
        source_simulation_id: t.source_simulation_id,
        source_message_id: t.source_message_id,
        provenance: t.provenance,
        annotator_id: t.annotator_id,
        approved_by: null,
      }));

      await this.evalRepo.insertTurns(records);
    }
  }

  /**
   * Compute quota shortfalls by comparing actual labeled turns against QUOTA targets.
   */
  private computeShortfalls(labeled: LabeledTurn[]): Array<{ category: string; difficulty: string; needed: number; have: number }> {
    const shortfalls: Array<{ category: string; difficulty: string; needed: number; have: number }> = [];

    for (const [category, quota] of Object.entries(DatasetBuildService.QUOTA)) {
      for (const [difficulty, needed] of Object.entries(quota)) {
        const have = labeled.filter(
          (t) => t.category === category && t.difficulty === difficulty,
        ).length;

        if (have < needed) {
          shortfalls.push({ category, difficulty, needed, have });
        }
      }
    }

    return shortfalls;
  }

  private sumQuota(difficulty: 'easy' | 'medium' | 'hard'): number {
    return Object.values(DatasetBuildService.QUOTA).reduce(
      (sum, q) => sum + (q[difficulty] ?? 0),
      0,
    );
  }

  /** Derive category string from evaluation tags + scenario_id. */
  private deriveCategory(tags: string[], scenarioId: string): string {
    if (Array.isArray(tags) && tags.length > 0) {
      const match = tags.find((t) =>
        ['refund', 'logistics', 'size', 'product', 'policy', 'chitchat', 'other'].includes(t),
      );
      if (match) return match;
    }

    const lower = (scenarioId ?? '').toLowerCase();
    if (lower.includes('refund')) return 'refund';
    if (lower.includes('logistics') || lower.includes('shipping') || lower.includes('delivery')) return 'logistics';
    if (lower.includes('size') || lower.includes('尺码')) return 'size';
    if (lower.includes('product') || lower.includes('商品')) return 'product';
    if (lower.includes('policy') || lower.includes('规则') || lower.includes('条款')) return 'policy';
    if (lower.includes('chitchat') || lower.includes('闲聊')) return 'chitchat';

    return 'other';
  }

  /** Derive difficulty from rating (1-5). */
  private deriveDifficulty(rating: number): 'easy' | 'medium' | 'hard' {
    if (rating >= 4) return 'easy';
    if (rating >= 2) return 'medium';
    return 'hard';
  }

  /** Extract triggers_handoff boolean from test case metadata. */
  private extractTriggersHandoff(metadata: Record<string, unknown> | null): boolean {
    if (metadata != null && typeof metadata === 'object') {
      const val = (metadata as Record<string, unknown>)['triggers_handoff'];
      if (typeof val === 'boolean') return val;
    }
    return false;
  }
}
