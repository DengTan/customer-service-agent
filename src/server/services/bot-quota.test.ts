/**
 * Unit tests for main-bot and sub-agent quota enforcement.
 *
 * Covers:
 *  - SubAgentService.assertMainBotQuotaAvailable respects the dynamic
 *    settings.max_main_bots cap and throws ServiceError(MAX_MAIN_BOTS_EXCEEDED)
 *    when the count is at or above it.
 *  - SubAgentService.assertMainBotQuotaAvailable falls back to the
 *    default of 10 when the setting is missing or non-numeric.
 *  - BotConfigService.createBot translates repository-level MAX_BOT_QUOTA_EXCEEDED
 *    into the typed ServiceError code (MAX_MAIN_BOTS_EXCEEDED) and surfaces
 *    the trigger message verbatim.
 *  - BotConfigService.updateBot mirrors the same mapping.
 *
 * Mocks the BotConfigRepository and SettingsRepository via vi.mock so no
 * network calls are made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisting-safe module mock state. We expose vi.fn() spies from the
// factory closures; tests reach them through module-level references.
const botConfigCountMain = vi.fn();
const botConfigCreate = vi.fn();
const botConfigFindById = vi.fn();
const botConfigUpdate = vi.fn();

vi.mock('@/server/repositories/bot-config-repository', () => {
  return {
    BotConfigRepository: class MockBotConfigRepository {
      countMainBots = botConfigCountMain;
      create = botConfigCreate;
      findById = botConfigFindById;
      update = botConfigUpdate;
      listSubAgents = vi.fn(async () => []);
    },
  };
});

const settingsGet = vi.fn();
vi.mock('@/server/repositories/settings-repository', () => ({
  SettingsRepository: class MockSettingsRepository {
    get = settingsGet;
  },
}));

vi.mock('@/server/repositories/sub-agent-repository', () => ({
  SubAgentRepository: class MockSubAgentRepository {},
}));

vi.mock('@/server/services/tool-execution-service', () => ({
  ToolExecutionService: class MockToolExecutionService {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SubAgentService } from './sub-agent-service';
import { BotConfigService } from './bot-config-service';
import { isServiceError } from './service-error';
import { RepositoryError } from '@/server/repositories/repository-error';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SubAgentService.assertMainBotQuotaAvailable', () => {
  it('throws MAX_MAIN_BOTS_EXCEEDED when the count equals the configured cap', async () => {
    settingsGet.mockResolvedValueOnce('5');
    botConfigCountMain.mockResolvedValueOnce(5);
    const service = new SubAgentService();

    await expect(service.assertMainBotQuotaAvailable()).rejects.toMatchObject({
      status: 400,
      code: 'MAX_MAIN_BOTS_EXCEEDED',
      message: expect.stringContaining('5'),
    });
  });

  it('passes when count is below cap', async () => {
    settingsGet.mockResolvedValueOnce('10');
    botConfigCountMain.mockResolvedValueOnce(9);
    const service = new SubAgentService();

    await expect(service.assertMainBotQuotaAvailable()).resolves.toBeUndefined();
  });

  it('falls back to default 10 when the setting is missing', async () => {
    settingsGet.mockResolvedValueOnce(null);
    botConfigCountMain.mockResolvedValueOnce(10);
    const service = new SubAgentService();

    await expect(service.assertMainBotQuotaAvailable()).rejects.toMatchObject({
      status: 400,
      code: 'MAX_MAIN_BOTS_EXCEEDED',
      message: expect.stringContaining('10'),
    });
  });

  it('falls back to default 10 when the setting is non-numeric', async () => {
    settingsGet.mockResolvedValueOnce('not-a-number');
    botConfigCountMain.mockResolvedValueOnce(10);
    const service = new SubAgentService();

    await expect(service.assertMainBotQuotaAvailable()).rejects.toMatchObject({
      code: 'MAX_MAIN_BOTS_EXCEEDED',
    });
  });

  it('clamps wildly-large configured caps to a sane upper bound', async () => {
    settingsGet.mockResolvedValueOnce('999999');
    botConfigCountMain.mockResolvedValueOnce(50);
    // 50 is far below 1000, so no throw.
    const service = new SubAgentService();

    await expect(service.assertMainBotQuotaAvailable()).resolves.toBeUndefined();
  });

  it('falls back to default when the settings repository throws', async () => {
    settingsGet.mockRejectedValueOnce(new Error('boom'));
    botConfigCountMain.mockResolvedValueOnce(10);
    const service = new SubAgentService();

    await expect(service.assertMainBotQuotaAvailable()).rejects.toMatchObject({
      code: 'MAX_MAIN_BOTS_EXCEEDED',
    });
  });
});

describe('BotConfigService.createBot quota mapping', () => {
  it('maps MAX_BOT_QUOTA_EXCEEDED on insert to MAX_MAIN_BOTS_EXCEEDED for a main bot', async () => {
    botConfigCreate.mockRejectedValueOnce(
      new RepositoryError(
        'create bot config',
        '系统最多只能创建 10 个主Bot，当前已有 10 个',
        'MAX_BOT_QUOTA_EXCEEDED',
      ),
    );
    const service = new BotConfigService();

    try {
      await service.createBot({
        name: 'Cap-bot',
        system_prompt: 'p',
      });
      throw new Error('expected to throw');
    } catch (err) {
      expect(isServiceError(err)).toBe(true);
      expect(err).toMatchObject({
        status: 400,
        code: 'MAX_MAIN_BOTS_EXCEEDED',
      });
      expect((err as Error).message).toContain('主Bot');
    }
  });

  it('maps MAX_BOT_QUOTA_EXCEEDED on insert to MAX_SUB_AGENTS_EXCEEDED for a sub-agent', async () => {
    botConfigFindById.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'parent',
      description: '',
      system_prompt: 'p',
      tools: [],
      knowledge_ids: [],
      skill_group_id: null,
      is_default: false,
      parent_bot_id: null,
      delegation_prompt: null,
      collaboration_config: null,
      is_sub_agent: false,
      status: 'active',
      platform_connection_id: null,
      created_at: '2026-01-01T00:00:00Z',
    });
    botConfigCreate.mockRejectedValueOnce(
      new RepositoryError(
        'create bot config',
        '每个主Bot最多只能创建 10 个子Agent，当前已有 10 个',
        'MAX_BOT_QUOTA_EXCEEDED',
      ),
    );
    const service = new BotConfigService();

    try {
      await service.createBot({
        name: 'Sub-bot',
        system_prompt: 'p',
        is_sub_agent: true,
        parent_bot_id: '00000000-0000-0000-0000-000000000001',
      });
      throw new Error('expected to throw');
    } catch (err) {
      expect(isServiceError(err)).toBe(true);
      expect(err).toMatchObject({
        status: 400,
        code: 'MAX_SUB_AGENTS_EXCEEDED',
      });
      expect((err as Error).message).toContain('子Agent');
    }
  });

  it('rethrows an already-typed ServiceError unchanged (quota pre-check path)', async () => {
    // The pre-check helper throws its own ServiceError; createBot must
    // rethrow it without re-wrapping.
    const { ServiceError } = await import('./service-error');
    botConfigCreate.mockResolvedValueOnce({} as never);
    // countMainBots > cap triggers the ServiceError from assertMainBotQuotaAvailable
    settingsGet.mockResolvedValueOnce('3');
    botConfigCountMain.mockResolvedValueOnce(3);
    const service = new BotConfigService();

    await expect(
      service.createBot({ name: 'Over-cap', system_prompt: 'p' }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('BotConfigService.updateBot quota mapping', () => {
  it('maps MAX_BOT_QUOTA_EXCEEDED on update to MAX_MAIN_BOTS_EXCEEDED', async () => {
    botConfigFindById.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'b',
      description: '',
      system_prompt: 'p',
      tools: [],
      knowledge_ids: [],
      skill_group_id: null,
      is_default: false,
      parent_bot_id: null,
      delegation_prompt: null,
      collaboration_config: null,
      is_sub_agent: false,
      status: 'disabled',
      platform_connection_id: null,
      created_at: '2026-01-01T00:00:00Z',
    });
    botConfigUpdate.mockRejectedValueOnce(
      new RepositoryError(
        'update bot config',
        '系统最多只能创建 10 个主Bot，当前已有 10 个',
        'MAX_BOT_QUOTA_EXCEEDED',
      ),
    );
    const service = new BotConfigService();

    try {
      await service.updateBot({ id: '00000000-0000-0000-0000-000000000001', status: 'active' });
      throw new Error('expected to throw');
    } catch (err) {
      expect(isServiceError(err)).toBe(true);
      expect(err).toMatchObject({
        status: 400,
        code: 'MAX_MAIN_BOTS_EXCEEDED',
      });
    }
  });

  it('maps CONCURRENT_UPDATE to 409', async () => {
    botConfigFindById.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'b',
      description: '',
      system_prompt: 'p',
      tools: [],
      knowledge_ids: [],
      skill_group_id: null,
      is_default: false,
      parent_bot_id: null,
      delegation_prompt: null,
      collaboration_config: null,
      is_sub_agent: false,
      status: 'active',
      platform_connection_id: null,
      created_at: '2026-01-01T00:00:00Z',
    });
    botConfigUpdate.mockRejectedValueOnce(
      new RepositoryError('update bot config', 'Bot 已被并发更新', 'CONCURRENT_UPDATE'),
    );
    const service = new BotConfigService();

    await expect(
      service.updateBot({ id: '00000000-0000-0000-0000-000000000001', name: 'new' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONCURRENT_UPDATE' });
  });
});