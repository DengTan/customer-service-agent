import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settingsList: vi.fn(),
  findUnhandled: vi.fn(),
  findRecent: vi.fn(),
  findRecentBatch: vi.fn(),
  createAlert: vi.fn(),
}));

vi.mock('@/storage/database/supabase-client', () => ({ isDemoMode: () => false }));
vi.mock('@/server/repositories/settings-repository', () => ({
  SettingsRepository: class { list = mocks.settingsList; get = vi.fn(); },
}));
vi.mock('@/server/repositories/conversation-repository', () => ({
  ConversationRepository: class { findUnhandledConversations = mocks.findUnhandled; },
}));
vi.mock('@/server/repositories/alert-repository', () => ({
  AlertRepository: class {
    findRecentUnresolved = mocks.findRecent;
    findRecentUnresolvedBatch = mocks.findRecentBatch;
    create = mocks.createAlert;
  },
}));
vi.mock('./ticket-service', () => ({ TicketService: class {} }));
vi.mock('./marketing-service', () => ({ MarketingService: class {} }));
vi.mock('./knowledge-learning-service', () => ({ KnowledgeLearningService: class {} }));
vi.mock('./smart-chunking-service', () => ({ clearChunkCache: vi.fn(), getCacheStats: () => ({ size: 0 }) }));

import { BackgroundSchedulerService } from './background-scheduler-service';

const enabledSettings = [
  { key: 'unhandled_remind_enabled', value: 'true' },
  { key: 'unhandled_remind_minutes', value: '30' },
];

describe('BackgroundSchedulerService.runUnhandledReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsList.mockResolvedValue(enabledSettings);
    mocks.findUnhandled.mockResolvedValue([]);
    mocks.findRecent.mockResolvedValue(null);
    mocks.findRecentBatch.mockResolvedValue([]);
    mocks.createAlert.mockResolvedValue({ id: 'alert' });
  });

  it('does no work when disabled', async () => {
    mocks.settingsList.mockResolvedValue([{ key: 'unhandled_remind_enabled', value: 'false' }]);
    const result = await new BackgroundSchedulerService().runUnhandledReminder();
    expect(result).toEqual({ ok: true, checked: 0, created: 0 });
    expect(mocks.findUnhandled).not.toHaveBeenCalled();
  });

  it('does no work for a zero threshold', async () => {
    mocks.settingsList.mockResolvedValue([
      { key: 'unhandled_remind_enabled', value: 'true' },
      { key: 'unhandled_remind_minutes', value: '0' },
    ]);
    const result = await new BackgroundSchedulerService().runUnhandledReminder();
    expect(result).toEqual({ ok: true, checked: 0, created: 0 });
    expect(mocks.findUnhandled).not.toHaveBeenCalled();
  });

  it('deduplicates all conversations with one batch alert query', async () => {
    mocks.findUnhandled.mockResolvedValue([
      { id: 'c1', title: 'One' },
      { id: 'c2', title: 'Two' },
      { id: 'c3', title: 'Three' },
    ]);
    mocks.findRecentBatch.mockResolvedValue([
      { conversation_id: 'c2', type: 'unhandled_remind' },
    ]);

    const result = await new BackgroundSchedulerService().runUnhandledReminder();

    expect(result).toEqual({ ok: true, checked: 3, created: 2 });
    expect(mocks.findRecentBatch).toHaveBeenCalledTimes(1);
    expect(mocks.findRecentBatch).toHaveBeenCalledWith(
      ['unhandled_remind'],
      expect.any(String),
    );
    expect(mocks.findRecent).not.toHaveBeenCalled();
    expect(mocks.createAlert).toHaveBeenCalledTimes(2);
    expect(mocks.createAlert).toHaveBeenNthCalledWith(1, expect.objectContaining({ conversation_id: 'c1' }));
    expect(mocks.createAlert).toHaveBeenNthCalledWith(2, expect.objectContaining({ conversation_id: 'c3' }));
  });

  it('shares one in-flight run across concurrent callers', async () => {
    let release: ((value: Array<{ id: string; title: string }>) => void) | undefined;
    mocks.findUnhandled.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const service = new BackgroundSchedulerService();

    const first = service.runUnhandledReminder();
    const second = service.runUnhandledReminder();
    release?.([{ id: 'c1', title: 'One' }]);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ ok: true, checked: 1, created: 1 });
    expect(b).toEqual(a);
    expect(mocks.settingsList).toHaveBeenCalledTimes(1);
    expect(mocks.findUnhandled).toHaveBeenCalledTimes(1);
    expect(mocks.createAlert).toHaveBeenCalledTimes(1);
  });
});
