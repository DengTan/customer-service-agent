import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { ConversationService } from './conversation-service';

function makeRepo(overrides: Partial<{
  countUserMessages: ReturnType<typeof vi.fn>;
}> = {}) {
  const countUserMessages = overrides.countUserMessages ?? vi.fn(async () => 0);
  return {
    countUserMessages,
    // Provide minimal no-op defaults so the service constructor is happy.
    findById: vi.fn(async () => null),
    listMessages: vi.fn(async () => []),
    countMessages: vi.fn(async () => 0),
    findCollaboration: vi.fn(async () => null),
    listParticipants: vi.fn(async () => []),
    findSessionInfo: vi.fn(async () => null),
    insertMessage: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    deleteMessages: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  } as never;
}

describe('ConversationService.countUserMessages', () => {
  it('delegates to ConversationRepository.countUserMessages', async () => {
    const countSpy = vi.fn(async () => 5);
    const repo = makeRepo({ countUserMessages: countSpy });
    const service = new ConversationService(repo);

    const count = await service.countUserMessages('conv-xyz');

    expect(count).toBe(5);
    expect(countSpy).toHaveBeenCalledWith('conv-xyz');
  });

  it('returns 0 when the repository throws — never blocks message intake', async () => {
    const countSpy = vi.fn(async () => { throw new Error('db down'); });
    const repo = makeRepo({ countUserMessages: countSpy });
    const service = new ConversationService(repo);

    const count = await service.countUserMessages('conv-err');

    expect(count).toBe(0);
  });
});