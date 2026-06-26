import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { KnowledgeGapRepository, type KnowledgeGapSignal, type KnowledgeGapStats, type KnowledgeGapStatus, type RecordGapParams } from '@/server/repositories/knowledge-gap-repository';
import type { KnowledgeSourceItem } from './knowledge-search-service';

const STOP_WORDS_ZH = new Set([
  '的', '了', '和', '是', '就', '都', '而', '及', '与', '或', '一个', '没有',
  '我们', '你们', '他们', '她们', '自己', '这样', '那样', '什么', '怎么', '如何',
  '为什么', '可以', '可能', '应该', '需要', '想要', '一下', '一些', '这个', '那个',
  '这些', '那些', '请问', '你好', '您好', '在吗', '在么',
]);

const MIN_QUESTION_LENGTH = 4; // 太短的消息（表情/问候）不纳入缺口
const HASH_PREFIX = 'v1'; // 用于将来切换归一化算法时区分

export interface AnalyzeParams {
  /** Original user message text */
  userQuestion: string;
  /** Sources returned by knowledge search for the AI response */
  sources: KnowledgeSourceItem[];
  /** Whether the user transferred to a human agent for this conversation */
  triggeredHandoff?: boolean;
  /** Conversation ID, used for backref */
  conversationId: string;
  /** Optional category hint, e.g. inferred from auto-reply match */
  category?: string | null;
}

export class KnowledgeGapService {
  constructor(
    private readonly repo: KnowledgeGapRepository = new KnowledgeGapRepository(),
  ) {}

  /**
   * Determine whether the current exchange represents a knowledge gap and record it.
   * Fire-and-forget safe (caller can `void` the returned promise).
   *
   * Gap conditions (any of):
   *   1. No sources returned at all
   *   2. All sources scored below the effective min_score threshold
   *   3. User explicitly transferred to human
   */
  async analyzeAndRecord(params: AnalyzeParams): Promise<KnowledgeGapSignal | null> {
    const question = params.userQuestion?.trim();
    if (!question) return null;

    // Filter out noise (greetings, very short messages)
    if (question.length < MIN_QUESTION_LENGTH) return null;
    if (STOP_WORDS_ZH.has(question.toLowerCase())) return null;

    const topScore = this.getTopScore(params.sources);
    const triggeredHandoff = Boolean(params.triggeredHandoff);

    const isGap = this.isGapCondition(topScore, params.sources.length, triggeredHandoff);
    if (!isGap) return null;

    const questionHash = this.hashQuestion(question);

    try {
      const recordParams: RecordGapParams = {
        questionHash,
        sampleQuestion: question,
        category: params.category ?? null,
        topScore,
        triggeredHandoff,
        conversationId: params.conversationId,
      };
      return await this.repo.recordSignal(recordParams);
    } catch (err) {
      logger.agent.warn('Failed to record knowledge gap signal', { error: err, question: question.slice(0, 50) });
      return null;
    }
  }

  /**
   * List gap signals for the admin/operator UI.
   */
  async listGaps(params: {
    status?: KnowledgeGapStatus | KnowledgeGapStatus[];
    minFrequency?: number;
    limit?: number;
  }) {
    return this.repo.list(params);
  }

  async getGap(id: string) {
    return this.repo.getById(id);
  }

  async resolveGap(id: string, options?: { resolvedBy?: string; linkedKnowledgeItemId?: string; notes?: string }) {
    return this.repo.updateStatus(id, 'resolved', options);
  }

  async dismissGap(id: string, options?: { resolvedBy?: string; notes?: string }) {
    return this.repo.updateStatus(id, 'dismissed', options);
  }

  async startProgress(id: string) {
    return this.repo.updateStatus(id, 'in_progress');
  }

  async reopen(id: string) {
    return this.repo.updateStatus(id, 'open');
  }

  async getStats(): Promise<KnowledgeGapStats> {
    return this.repo.getStats();
  }

  /**
   * Expose the question hash helper for callers (e.g. when promoting a gap to a learning candidate).
   */
  hashQuestion(question: string): string {
    return HASH_PREFIX + ':' + createHash('sha256').update(this.normalize(question)).digest('hex');
  }

  private normalize(question: string): string {
    return question
      .toLowerCase()
      .replace(/[\s\u3000]+/g, ' ') // collapse whitespace
      .replace(/[，。！？、；：""''「」『』（）()\[\]【】《》<>.,!?;:"'`´~～]/g, '') // strip punctuation
      .replace(/(.)\1{2,}/g, '$1$1') // collapse repeated chars (哈哈哈哈哈 → 哈哈)
      .trim();
  }

  private getTopScore(sources: KnowledgeSourceItem[]): number | null {
    if (!sources || sources.length === 0) return null;
    const scores = sources.map((s) => Number(s.score ?? 0)).filter((n) => Number.isFinite(n));
    if (scores.length === 0) return null;
    return Math.max(...scores);
  }

  private isGapCondition(topScore: number | null, sourceCount: number, triggeredHandoff: boolean): boolean {
    if (sourceCount === 0) return true;
    if (topScore === null) return true;
    // 0.5 is a permissive floor — anything below is noise rather than a useful match
    if (topScore < 0.5) return true;
    if (triggeredHandoff) return true;
    return false;
  }
}
