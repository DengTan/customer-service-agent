import { ShopsRepository, type CreateShopInput, type UpdateShopInput } from '@/server/repositories/shops-repository';
import type { ShopRow } from '@/server/repositories/types';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class ShopService {
  constructor(private readonly repo = new ShopsRepository()) {}

  async list(): Promise<{ shops: ShopRow[] }> {
    try {
      const shops = await this.repo.list();
      return { shops };
    } catch (error) {
      throw toServiceError(error, '获取店铺列表失败', 'DB_ERROR');
    }
  }

  async getById(id: string): Promise<{ shop: ShopRow | null }> {
    try {
      const shop = await this.repo.getById(id);
      return { shop };
    } catch (error) {
      throw toServiceError(error, '获取店铺详情失败', 'DB_ERROR');
    }
  }

  async create(input: CreateShopInput): Promise<{ shop: ShopRow }> {
    if (!input.name?.trim()) {
      throw new ServiceError('店铺名称不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!input.platform) {
      throw new ServiceError('请选择平台类型', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // Set defaults for wizard config fields
    const enrichedInput: CreateShopInput = {
      ...input,
      knowledge_ids: input.knowledge_ids ?? [],
      config: input.config ?? {
        shipping_policy: 'all_free',
        allow_designated_express: false,
        shipping_time: 'same_day',
        shipping_origin: '',
        return_policy_7days: false,
        handoff_timeout_hours: 24,
        work_hours: { start: '08:00', end: '23:00' },
        default_reply_ids: [],
        handoff_reply_ids: [],
      },
      agent_quota: input.agent_quota ?? 0,
    };

    try {
      const shop = await this.repo.create(enrichedInput);
      return { shop };
    } catch (error) {
      throw toServiceError(error, '创建店铺失败', 'DB_ERROR');
    }
  }

  async update(id: string, input: UpdateShopInput): Promise<{ shop: ShopRow }> {
    if (!id) {
      throw new ServiceError('店铺ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repo.getById(id);
      if (!existing) {
        throw new ServiceError('店铺不存在', { status: 404, code: 'NOT_FOUND' });
      }
      const shop = await this.repo.update(id, input);
      return { shop };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '更新店铺失败', 'DB_ERROR');
    }
  }

  async delete(id: string): Promise<{ success: boolean }> {
    if (!id) {
      throw new ServiceError('店铺ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repo.getById(id);
      if (!existing) {
        throw new ServiceError('店铺不存在', { status: 404, code: 'NOT_FOUND' });
      }
      await this.repo.delete(id);
      return { success: true };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '删除店铺失败', 'DB_ERROR');
    }
  }

  async getStats(): Promise<{ total: number; totalAccounts: number; usedAccounts: number; availableAccounts: number }> {
    try {
      return await this.repo.getStats();
    } catch (error) {
      throw toServiceError(error, '获取店铺统计失败', 'DB_ERROR');
    }
  }
}
