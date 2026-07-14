/**
 * Phase 4: rating gating helpers for the chat UI.
 *
 * `shouldShowRatingCard` decides whether the rating card should be rendered
 * for the currently active conversation. The decision depends on a
 * per-conversation capability (`rating_enabled`) sourced from the conversation
 * detail response — the chat page must NOT read the admin-only /api/settings
 * endpoint directly. The detail endpoint is the single source of truth.
 *
 * `processRatingSubmit` posts the rating and classifies the response into a
 * small union so the UI can:
 *   - Show "感谢您的评价！" only after a confirmed 2xx success
 *   - Hide the rating card permanently on RATING_DISABLED (403)
 *   - Keep the rating card and show an error toast on RETRY-able failures
 *
 * Both helpers are pure (no React, no global fetch) so the test surface is
 * deterministic.
 */

export type RatingCapability = { rating_enabled: boolean };

export interface ShouldShowRatingCardInput {
  conversationStatus?: string | null;
  hasRating: boolean;
  ratingEnabled: boolean;
}

/**
 * Pure decision: show the rating card only when:
 *   - The conversation has ended (status === 'ended')
 *   - The user has not yet rated (no existing rating)
 *   - The rating capability is enabled for this conversation
 */
export function shouldShowRatingCard(input: ShouldShowRatingCardInput): boolean {
  if (!input.ratingEnabled) return false;
  if (input.hasRating) return false;
  return input.conversationStatus === 'ended';
}

export type RatingSubmitResult =
  | { ok: true }
  | { ok: false; code: 'RATING_DISABLED' }
  | { ok: false; code: 'RETRY' };

export interface ProcessRatingSubmitInput {
  conversationId: string;
  rating: number;
  comment: string;
  /**
   * Dependency-injected fetch so tests can stub it. The default uses the
   * global fetch in the browser / Node 18+.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Posts the rating to the conversation detail endpoint and classifies the
 * server's response. The caller MUST treat `ok: true` as the only signal to
 * flip the UI to "感谢您的评价" — non-2xx responses (including RATING_DISABLED)
 * leave the rating card in its previous state.
 */
export async function processRatingSubmit(
  input: ProcessRatingSubmitInput,
): Promise<RatingSubmitResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `/api/conversations/${encodeURIComponent(input.conversationId)}/rating`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: input.rating, comment: input.comment }),
      },
    );
    if (res.ok) return { ok: true };
    // Try to read the structured error code — the API returns { code: 'RATING_DISABLED' }
    // on 403 when the admin has turned the capability off.
    try {
      const body = await res.json();
      if (body?.code === 'RATING_DISABLED') {
        return { ok: false, code: 'RATING_DISABLED' };
      }
    } catch {
      // body was not JSON; fall through to RETRY
    }
    return { ok: false, code: 'RETRY' };
  } catch {
    // Network failure, abort, or thrown fetch — surface as RETRY so the UI
    // can keep the card and let the user try again.
    return { ok: false, code: 'RETRY' };
  }
}
