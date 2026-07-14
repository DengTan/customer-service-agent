/**
 * Pure helpers for the conversation max-turns enforcement.
 *
 * The route passes `existingUserTurns` — the count of `messages.role='user'`
 * rows for the conversation BEFORE the candidate message is inserted. This is
 * the authoritative user-turn count, not the inflated `message_count` column
 * which also includes assistant / system / agent / internal_note rows.
 *
 * Semantics: `max_turns=N` allows the first N user messages and REJECTS the
 * (N+1)th. `max_turns=0` (or any non-positive integer) means "unlimited".
 */

export interface MaxTurnsCheck {
  blocked: false;
}

export interface MaxTurnsBlocked {
  blocked: true;
  limit: number;
  /** User-facing copy. Must say "轮次" / "轮对话", never "条消息". */
  message: string;
}

export function evaluateMaxTurns(input: {
  existingUserTurns: number;
  maxTurns: number;
}): MaxTurnsCheck | MaxTurnsBlocked {
  const { existingUserTurns, maxTurns } = input;
  // No limit configured → always allowed.
  if (!maxTurns || maxTurns <= 0) {
    return { blocked: false };
  }
  // existingUserTurns === maxTurns means the next user message would be the (N+1)th.
  if (existingUserTurns >= maxTurns) {
    return {
      blocked: true,
      limit: maxTurns,
      message: `对话已达到 ${maxTurns} 轮对话上限，已自动结束。如需继续请创建新对话。`,
    };
  }
  return { blocked: false };
}
