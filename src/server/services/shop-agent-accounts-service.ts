import { ShopAgentAccountsRepository, type CreateShopAgentAccountInput } from '@/server/repositories/shop-agent-accounts-repository';
import type { ShopAgentAccountRow } from '@/server/repositories/types';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { encrypt } from '@/lib/crypto';

export class ShopAgentAccountsService {
  constructor(private readonly repo = new ShopAgentAccountsRepository()) {}

  async listByShopId(shopId: string): Promise<{ accounts: (ShopAgentAccountRow & { encrypted_password?: undefined })[] }> {
    try {
      const accounts = await this.repo.listByShopId(shopId);
      // Strip encrypted_password from all accounts before returning
      const safe = accounts.map(({ encrypted_password: _, ...rest }) => rest as unknown as ShopAgentAccountRow & { encrypted_password?: undefined });
      return { accounts: safe };
    } catch (error) {
      throw toServiceError(error, '获取客服账号列表失败', 'DB_ERROR');
    }
  }

  async countByShopId(shopId: string): Promise<{ total: number; active: number }> {
    try {
      return await this.repo.countByShopId(shopId);
    } catch (error) {
      throw toServiceError(error, '获取客服账号统计失败', 'DB_ERROR');
    }
  }

  async create(shopId: string, accountName: string, plainPassword: string, platform?: string): Promise<{ account: ShopAgentAccountRow }> {
    if (!accountName.trim()) {
      throw new ServiceError('客服账号名称不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!plainPassword.trim()) {
      throw new ServiceError('客服密码不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // Encrypt password once before storing
    const encryptedPassword = encrypt(plainPassword);

    const input: CreateShopAgentAccountInput = {
      shop_id: shopId,
      account_name: accountName,
      encrypted_password: encryptedPassword,
      platform: platform || null,
    };

    try {
      const account = await this.repo.create(input);
      // Strip password from response
      const { encrypted_password: _, ...safe } = account;
      return { account: safe as ShopAgentAccountRow & { encrypted_password?: undefined } };
    } catch (error) {
      throw toServiceError(error, '创建客服账号失败', 'DB_ERROR');
    }
  }

  async delete(id: string): Promise<{ success: boolean }> {
    if (!id) {
      throw new ServiceError('ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.delete(id);
      return { success: true };
    } catch (error) {
      throw toServiceError(error, '删除客服账号失败', 'DB_ERROR');
    }
  }
}
