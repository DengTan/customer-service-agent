/**
 * P3 Phase 5 — Pending Choice Service.
 *
 * Manages in-memory pending choices that the LLM wants to defer (e.g., tool call
 * execution, multi-hop retrieval). Choices are keyed by (conversationId, choiceId)
 * and expire after a configurable TTL.
 */
import { logger } from '@/lib/logger';

export interface PendingChoice {
  id: string;
  conversationId: string;
  /** The raw choice payload from the LLM, e.g. a deferred tool call */
  payload: Record<string, unknown>;
  /** Human-readable description for the UI */
  description: string;
  /** Unix timestamp (ms) when this choice was created */
  createdAt: number;
  /** Unix timestamp (ms) when this choice expires */
  expiresAt: number;
  /** Optional: metadata from the orchestrator (e.g. retrieval span, citation count) */
  metadata?: Record<string, unknown>;
}

export interface CreatePendingChoiceParams {
  conversationId: string;
  payload: Record<string, unknown>;
  description: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class PendingChoiceService {
  private readonly choices = new Map<string, PendingChoice>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private key(conversationId: string, choiceId: string): string {
    return `${conversationId}::${choiceId}`;
  }

  private now(): number {
    return Date.now();
  }

  /**
   * Create a pending choice and return its id.
   * Returns null if a choice with the same id already exists and hasn't expired.
   */
  create(params: CreatePendingChoiceParams): string | null {
    const id = `pc_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const now = this.now();
    const k = this.key(params.conversationId, id);

    // Don't overwrite an existing unexpired choice with the same key
    const existing = this.choices.get(k);
    if (existing && existing.expiresAt > now) {
      logger.agent.debug('[PendingChoiceService] Choice already exists', { conversationId: params.conversationId, id });
      return null;
    }

    const choice: PendingChoice = {
      id,
      conversationId: params.conversationId,
      payload: params.payload,
      description: params.description,
      createdAt: now,
      expiresAt: now + (params.ttlMs ?? this.ttlMs),
      metadata: params.metadata,
    };

    this.choices.set(k, choice);
    this.cleanup();

    logger.agent.debug('[PendingChoiceService] Created pending choice', {
      conversationId: params.conversationId,
      choiceId: id,
      expiresAt: choice.expiresAt,
    });

    return id;
  }

  /**
   * Get a pending choice by id. Returns null if not found or expired.
   */
  get(conversationId: string, choiceId: string): PendingChoice | null {
    const k = this.key(conversationId, choiceId);
    const choice = this.choices.get(k);
    if (!choice) return null;
    if (choice.expiresAt <= this.now()) {
      this.choices.delete(k);
      return null;
    }
    return choice;
  }

  /**
   * Consume (delete) a pending choice.
   * Returns true if the choice existed and was deleted, false otherwise.
   */
  consume(conversationId: string, choiceId: string): boolean {
    const k = this.key(conversationId, choiceId);
    const deleted = this.choices.delete(k);
    if (deleted) {
      logger.agent.debug('[PendingChoiceService] Consumed pending choice', { conversationId, choiceId });
    }
    return deleted;
  }

  /**
   * Get all unexpired pending choices for a conversation.
   */
  listForConversation(conversationId: string): PendingChoice[] {
    this.cleanup();
    const results: PendingChoice[] = [];
    const prefix = `${conversationId}::`;
    for (const [k, v] of this.choices) {
      if (k.startsWith(prefix) && v.expiresAt > this.now()) {
        results.push(v);
      }
    }
    return results;
  }

  /**
   * Remove all expired choices.
   */
  cleanup(): number {
    const now = this.now();
    let removed = 0;
    for (const [k, v] of this.choices) {
      if (v.expiresAt <= now) {
        this.choices.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all choices for a conversation.
   */
  clearConversation(conversationId: string): void {
    const prefix = `${conversationId}::`;
    for (const k of this.choices.keys()) {
      if (k.startsWith(prefix)) {
        this.choices.delete(k);
      }
    }
  }

  /** Number of active (unexpired) choices. */
  get size(): number {
    this.cleanup();
    return this.choices.size;
  }
}
