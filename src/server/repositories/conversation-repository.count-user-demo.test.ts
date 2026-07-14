import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => true,
}));

import { ConversationRepository } from './conversation-repository';
import { DEMO_MESSAGES } from './demo-data/demo-conversations';

describe('ConversationRepository.countUserMessages (demo mode)', () => {
  it('returns the number of role=user messages in the demo store', async () => {
    const repo = new ConversationRepository({} as never);
    const expected = DEMO_MESSAGES.filter(m => m.conversation_id === 'demo-conv-1' && m.role === 'user').length;
    const count = await repo.countUserMessages('demo-conv-1');
    expect(count).toBe(expected);
  });

  it('does not include assistant, system, agent or internal_note messages in the count', async () => {
    const repo = new ConversationRepository({} as never);
    const count = await repo.countUserMessages('demo-conv-2');
    // demo-conv-2 messages: 5 user + 3 assistant — only user counts.
    const expected = DEMO_MESSAGES.filter(m => m.conversation_id === 'demo-conv-2' && m.role === 'user').length;
    expect(count).toBe(expected);
    expect(expected).toBeGreaterThan(0);
    // Sanity: there are non-user messages in demo-conv-2 (assistant).
    const nonUser = DEMO_MESSAGES.filter(m => m.conversation_id === 'demo-conv-2' && m.role !== 'user').length;
    expect(nonUser).toBeGreaterThan(0);
  });
});