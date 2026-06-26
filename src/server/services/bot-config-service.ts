import {
  BotConfigRepository,
  type BotConfigRow,
  type CreateBotConfigInput,
  type UpdateBotConfigInput,
} from '@/server/repositories/bot-config-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class BotConfigService {
  constructor(private readonly repo = new BotConfigRepository()) {}

  async listBots(includeSubAgents: boolean = true): Promise<{ bots: BotConfigRow[] }> {
    try {
      const bots = await this.repo.list(includeSubAgents);
      return { bots };
    } catch (error) {
      throw toServiceError(error, '获取Bot配置列表失败', 'DB_ERROR');
    }
  }

  async createBot(input: CreateBotConfigInput): Promise<{ bot: BotConfigRow }> {
    if (!input.name || !input.system_prompt) {
      throw new ServiceError('名称和系统提示词为必填项', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const bot = await this.repo.create(input);
      return { bot };
    } catch (error) {
      throw toServiceError(error, '创建Bot配置失败', 'DB_ERROR');
    }
  }

  async updateBot(input: UpdateBotConfigInput): Promise<{ bot: BotConfigRow }> {
    if (!input.id) {
      throw new ServiceError('缺少Bot ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const bot = await this.repo.update(input);
      return { bot };
    } catch (error) {
      throw toServiceError(error, '更新Bot配置失败', 'DB_ERROR');
    }
  }

  async deleteBot(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少Bot ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除Bot配置失败', 'DB_ERROR');
    }
  }
}
