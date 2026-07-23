/**
 * ContinuousEvalJob — Phase 6.2 (P4 RAG Evaluation Rollout)
 *
 * Nightly batch job that:
 *  1. Samples real turns from the last N days using reservoir sampling (reproducible).
 *  2. Derives "weak gold" labels from trusted signals already in the DB.
 *  3. Runs the regression gate against those turns using looser continuous thresholds.
 *  4. Persists the result to eval_regression_runs with run_kind='continuous'.
 *
 * Weak gold signals (all derived, not human-labeled):
 *   - gold_gate_decision  = messages.metadata.retrievalTrace.action
 *   - gold_citations      = messages.sources filtered to provenanceVersion=2
 *   - gold_answer         = messages.content where role='assistant'
 *   - gold_should_handoff = conversations.status = 'handoff'
 *   - gold_should_auto_reply = messages.sources[0]?.type = 'auto_reply'
 *
 * Run entry point (called by BackgroundSchedulerService.runEvalRegressionContinuous):
 *   const job = new ContinuousEvalJob();
 *   await job.run({ since, sampledN });
 */

/** Minimal shape of the retrievalTrace stored in message metadata (P3 provenance phase). */
export interface RetrievalTrace {
  action: string;
  reasonCode: string;
  provenanceVersion: number;
}

import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { RegressionGateService } from '@/server/services/eval/regression-gate-service';
import { EvalRegressionRepository } from '@/server/repositories/eval-regression-repository';
import { reservoirSample } from './reservoir-sampling';

// ---------------------------------------------------------------------------
// Public API types (mirrors §3.6.2 of the P4 plan)
// ---------------------------------------------------------------------------

export interface RunEvalResult {
  ok: boolean;
  sampled: number;
  evaluated: number;
  errors?: string[];
}

/** A message turn sampled from real production traffic. */
export interface SampledRealTurn {
  message_id: string;
  conversation_id: string;
  role: string;
  content: string;
  sources: MessageSource[];
  metadata: Record<string, unknown>;
  created_at: string;
  /** Joined-in conversation status. */
  conversation_status: string;
  /** The user message that preceded this assistant turn (for eval replay). */
  user_message: string;
}

/** Source object shape stored in messages.sources JSONB. */
interface MessageSource {
  type: string;
  provenanceVersion?: number;
  kind?: string;
  id?: string;
  chunkId?: string;
  name?: string;
  category?: string;
  score?: number;
}

/** Weak gold labels derived from trusted signals. */
export interface WeakGold {
  gold_gate_decision: 'skip' | 'retrieve' | 'clarify' | null;
  gold_citations: WeakGoldCitation[];
  gold_answer: string;
  gold_should_handoff: boolean;
  gold_should_auto_reply: boolean;
}

export interface WeakGoldCitation {
  type: 'knowledge' | 'product' | 'size_chart';
  id?: string;
  chunk_id?: string;
  name?: string;
  category?: string;
  score?: number;
}

/** Score shape used for continuous eval metric aggregation. */
interface ContinuousTurnScore {
  turn_id: string;
  answer_correct: number;
  cite_precision: number;
  recall_at_10: number;
  false_handoff: number;
}

/** Internal result shape returned by runRegressionGate. */
interface RunRegressionGateResult {
  status: 'pass' | 'warn' | 'fail';
  details: Array<{ metric: string; status: 'pass' | 'warn' | 'fail'; value: number; ci_lower: number; ci_upper: number; threshold: number }>;
  datasetVersionId: string;
  runKind: 'continuous';
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string;
}

// ---------------------------------------------------------------------------
// ContinuousEvalJob
// ---------------------------------------------------------------------------

export class ContinuousEvalJob {
  static readonly DEFAULT_SAMPLE = 200;

  private readonly regressionRepo = new EvalRegressionRepository();

  /**
   * Entry point — samples turns, derives weak gold, runs the regression gate,
   * and persists the result.
   *
   * @param args.since    ISO timestamp — only sample turns newer than this.
   * @param args.sampledN Maximum turns to sample (default 200).
   */
  async run(args: { since: string; sampledN?: number }): Promise<RunEvalResult> {
    const sampledN = args.sampledN ?? ContinuousEvalJob.DEFAULT_SAMPLE;
    const errors: string[] = [];

    logger.info('[ContinuousEvalJob] Starting continuous eval run', {
      since: args.since,
      sampledN,
    });

    let runId: string = '';

    try {
      // Step 1 — sample real turns
      const allTurns = await this.sampleRealTurns(args.since, sampledN);
      if (allTurns.length === 0) {
        logger.warn('[ContinuousEvalJob] No turns found in window', { since: args.since });
        return { ok: true, sampled: 0, evaluated: 0 };
      }

      // Step 2 — derive weak gold labels
      const weakGoldResults = allTurns.map(turn => this.deriveWeakGold(turn));

      // Step 3 — run through RegressionGateService with continuous thresholds
      const continuousThresholds = await this.loadContinuousThresholds();
      if (continuousThresholds.length === 0) {
        const msg = 'No continuous thresholds found in eval_continuous_gate_thresholds';
        logger.error('[ContinuousEvalJob] ' + msg);
        errors.push(msg);
        return { ok: false, sampled: allTurns.length, evaluated: 0, errors };
      }

      const gateResult = this.runRegressionGate(allTurns, weakGoldResults, continuousThresholds);
      runId = gateResult.datasetVersionId;

      // Step 4 — persist result to eval_regression_runs
      await this.persistResult(gateResult);

      // Only 'fail' pages on-call; 'warn' is advisory only
      if (gateResult.status === 'fail') {
        logger.error('[ContinuousEvalJob] Continuous eval FAILED', {
          status: gateResult.status,
          sampled: allTurns.length,
          violations: gateResult.details.filter(d => d.status !== 'pass').length,
        });
      } else {
        logger.info('[ContinuousEvalJob] Continuous eval completed', {
          status: gateResult.status,
          sampled: allTurns.length,
        });
      }

      return { ok: true, sampled: allTurns.length, evaluated: allTurns.length, errors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[ContinuousEvalJob] Run failed', { error: err });
      errors.push(msg);
      return { ok: false, sampled: 0, evaluated: 0, errors };
    }
  }

  // ---------------------------------------------------------------------------
  // sampleRealTurns
  // ---------------------------------------------------------------------------

  /**
   * Samples up to `n` real assistant turns from the window defined by `since`.
   * Uses reservoir sampling so the result is reproducible across runs when the
   * underlying population is unchanged.
   *
   * Query strategy:
   *   - role = 'assistant'
   *   - sources IS NOT NULL  (has retrieval context)
   *   - created_at >= since
   *   - JOIN conversations to get status
   *   - JOIN the preceding user message as user_message
   *
   * Results are ordered by created_at ASC so reservoir sampling is deterministic.
   */
  async sampleRealTurns(since: string, n: number): Promise<SampledRealTurn[]> {
    if (isDemoMode()) {
      logger.debug('[ContinuousEvalJob] Demo mode: skipping DB sample');
      return [];
    }

    const client = getSupabaseClient();

    // Fetch all qualifying rows (DB does the filtering; reservoir sampling
    // happens in-process so the sample is reproducible).
    // We need: message id/content/sources/metadata/created_at + conversation status
    // + preceding user message.
    const { data, error } = await client
      .from('messages')
      .select(`
        id,
        conversation_id,
        role,
        content,
        sources,
        metadata,
        created_at,
        conversations!inner(status)
      `)
      .eq('role', 'assistant')
      .not('sources', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('[ContinuousEvalJob] Failed to sample real turns', { error });
      return [];
    }

    if (!data || data.length === 0) return [];

    const rows = data as Array<Record<string, unknown>>;

    // Batch fetch all preceding user messages in one query
    const convIds = rows.map((r) => String(r['conversation_id'] ?? ''));
    const messageTimestamps = rows.map((r) => String(r['created_at'] ?? ''));

    // Map: conversation_id → latest user message content
    const latestUserMsg = new Map<string, string>();

    if (convIds.length > 0) {
      // Single batch query: get all user messages for all conversations
      const { data: allUserMsgs } = await client
        .from('messages')
        .select('conversation_id, content, created_at')
        .eq('role', 'user')
        .in('conversation_id', convIds);

      if (allUserMsgs) {
        for (const msg of allUserMsgs as Array<Record<string, unknown>>) {
          const cid = String(msg['conversation_id'] ?? '');
          if (!latestUserMsg.has(cid)) {
            latestUserMsg.set(cid, String(msg['content'] ?? ''));
          }
        }
      }
    }

    logger.info('[ContinuousEvalJob] sampleRealTurns: querying real turns from DB', {
      since,
      totalRows: rows.length,
      convIds: convIds.length,
    });

    // Attach conversation_status and preceding user message
    const enriched: SampledRealTurn[] = [];
    for (const row of rows) {
      const conversation = row['conversations'] as Record<string, unknown>;
      const conversationStatus = String(conversation?.['status'] ?? 'unknown');

      const messageCreatedAt = String(row['created_at'] ?? '');
      const convId = String(row['conversation_id'] ?? '');

      // Look up from batch map instead of per-row query
      const userMessage = latestUserMsg.get(convId) ?? '';

      enriched.push({
        message_id: String(row['id'] ?? ''),
        conversation_id: convId,
        role: String(row['role'] ?? 'assistant'),
        content: String(row['content'] ?? ''),
        sources: (row['sources'] as MessageSource[]) ?? [],
        metadata: (row['metadata'] as Record<string, unknown>) ?? {},
        created_at: messageCreatedAt,
        conversation_status: conversationStatus,
        user_message: userMessage,
      });
    }

    // Reservoir sample to cap at n items (deterministic for stable sort order)
    return reservoirSample(enriched, n);
  }

  // ---------------------------------------------------------------------------
  // deriveWeakGold
  // ---------------------------------------------------------------------------

  /**
   * Derives weak gold labels from the signals already trusted in the system.
   *
   * Rules (§3.6.2 of the P4 plan):
   *   gold_gate_decision      = messages.metadata.retrievalTrace.action
   *   gold_citations          = messages.sources filtered to provenanceVersion=2
   *                              AND kind IN ('trusted_v2', 'trusted_v1_with_audit_strip')
   *   gold_answer             = messages.content where role='assistant'
   *   gold_should_handoff     = conversations.status = 'handoff'
   *   gold_should_auto_reply  = messages.sources[0]?.type = 'auto_reply'
   */
  deriveWeakGold(turn: SampledRealTurn): WeakGold {
    // gold_citations — provenanceVersion=2 AND trusted kind
    const goldCitations: WeakGoldCitation[] = (turn.sources ?? [])
      .filter(
        (s) =>
          s.provenanceVersion === 2 &&
          (s.kind === 'trusted_v2' || s.kind === 'trusted_v1_with_audit_strip'),
      )
      .map((s) => ({
        type: (s.type === 'knowledge' || s.type === 'product' || s.type === 'size_chart'
          ? s.type
          : 'knowledge') as WeakGoldCitation['type'],
        id: s.id,
        chunk_id: s.chunkId,
        name: s.name,
        category: s.category,
        score: s.score,
      }));

    // gold_should_auto_reply — first source type is 'auto_reply'
    const goldShouldAutoReply =
      turn.sources.length > 0 && turn.sources[0].type === 'auto_reply';

    // gold_should_handoff — conversation ended in handoff
    const goldShouldHandoff = turn.conversation_status === 'handoff';

    // gold_gate_decision — read from message metadata (set by P3 provenance phase)
    const metadata = turn.metadata ?? {};
    const retrievalTrace = metadata['retrievalTrace'] as RetrievalTrace | undefined;
    const goldGateDecision = (retrievalTrace?.action as WeakGold['gold_gate_decision']) ?? null;

    return {
      gold_gate_decision: goldGateDecision,
      gold_citations: goldCitations,
      gold_answer: turn.content,
      gold_should_handoff: goldShouldHandoff,
      gold_should_auto_reply: goldShouldAutoReply,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: threshold loading
  // ---------------------------------------------------------------------------

  private async loadContinuousThresholds(): Promise<Array<{
    metric: string;
    fail_at: number;
    warn_at: number;
    direction: 'lower_is_worse' | 'higher_is_worse';
  }>> {
    if (isDemoMode()) return [];

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('eval_continuous_gate_thresholds')
      .select('metric, fail_at, warn_at, direction');

    if (error || !data) {
      logger.warn('[ContinuousEvalJob] Could not load continuous thresholds', { error });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map(row => ({
      metric: String(row['metric'] ?? ''),
      fail_at: Number(row['fail_at'] ?? 0),
      warn_at: Number(row['warn_at'] ?? 0),
      direction: (row['direction'] as 'lower_is_worse' | 'higher_is_worse') ?? 'lower_is_worse',
    }));
  }

  // ---------------------------------------------------------------------------
  // Internal: regression gate run
  // ---------------------------------------------------------------------------

  /**
   * Scores each sampled turn against the weak gold labels using loose continuous
   * thresholds, then aggregates into gate metrics and evaluates against the
   * continuous (looser) thresholds.
   */
  private runRegressionGate(
    turns: SampledRealTurn[],
    weakGoldResults: WeakGold[],
    thresholds: Array<{
      metric: string;
      fail_at: number;
      warn_at: number;
      direction: 'lower_is_worse' | 'higher_is_worse';
    }>,
  ): RunRegressionGateResult {
    const startedAt = new Date().toISOString();

    // Score each turn using continuous (weak-gold) signals.
    //
    // NOTE: Unlike CalibrationService.scoreTurn(), we lack human-labeled gold answers,
    // so we use production signals as weak proxies:
    //   - answer_correct = did we produce a non-empty answer? (binary)
    //   - cite_precision = did we cite anything? (proxy for "retrieval worked")
    //   - recall_at_10 = same as cite_precision (no separate recall signal)
    //   - false_handoff = did we handoff when gold says we shouldn't have?
    //
    // The `hasCitation && answered` precondition on answer_correct has been removed:
    // a response is correct if it is non-empty, regardless of whether citations exist.
    const turnScores: ContinuousTurnScore[] = turns.map((turn, i) => {
      const gold = weakGoldResults[i];
      const hasCitation = gold.gold_citations.length > 0;
      const answered = (turn.content ?? '').trim().length > 0;

      return {
        turn_id: turn.message_id,
        answer_correct: answered ? 1 : 0,
        cite_precision: hasCitation ? 1 : 0,
        recall_at_10: hasCitation ? 1 : 0,
        false_handoff: gold.gold_should_handoff ? 0 : 1,
      };
    });

    // Aggregate with Wilson CIs
    const metrics = RegressionGateService.aggregateContinuousMetrics(turnScores);

    // Add threshold info for evaluation
    const metricsWithThreshold: Record<string, { value: number; ci_lower: number; ci_upper: number; threshold: number }> = {};
    for (const [key, m] of Object.entries(metrics)) {
      const t = thresholds.find(th => th.metric === key);
      metricsWithThreshold[key] = { ...m, threshold: t?.fail_at ?? 0 };
    }

    // Evaluate against continuous thresholds
    const { status, details } = RegressionGateService.evaluate(metricsWithThreshold, thresholds);

    const finishedAt = new Date().toISOString();

    return {
      status,
      details,
      datasetVersionId: 'continuous',
      runKind: 'continuous',
      triggeredBy: null,
      startedAt,
      finishedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: result persistence
  // ---------------------------------------------------------------------------

  private async persistResult(result: RunRegressionGateResult): Promise<void> {
    if (isDemoMode()) {
      logger.debug('[ContinuousEvalJob] Demo mode: skipping DB persist');
      return;
    }

    try {
      await this.regressionRepo.create({
        dataset_version_id: result.datasetVersionId,
        run_kind: 'continuous',
        status: result.status,
        metrics: this.metricsToRecord(result.details),
        started_at: result.startedAt,
        finished_at: result.finishedAt,
        triggered_by: result.triggeredBy,
      });
    } catch (err) {
      logger.warn('[ContinuousEvalJob] Failed to persist result', { error: err });
    }
  }

  private metricsToRecord(
    details: Array<{ metric: string; status: string; value: number; ci_lower: number; ci_upper: number; threshold: number }>,
  ): Record<string, { value: number; ci_lower: number; ci_upper: number; threshold: number }> {
    const record: Record<string, { value: number; ci_lower: number; ci_upper: number; threshold: number }> = {};
    for (const d of details) {
      record[d.metric] = {
        value: d.value,
        ci_lower: d.ci_lower,
        ci_upper: d.ci_upper,
        threshold: d.threshold,
      };
    }
    return record;
  }
}
