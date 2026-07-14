import { logger } from '@/lib/logger';
import {
  CustomerRepository,
  type CustomerFilters,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from '@/server/repositories/customer-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { RepositoryError } from '@/server/repositories/repository-error';

export interface FindOrCreateFromConversationParams {
  conversationId: string;
  source: string; // 'web' | 'qianniu' | 'doudian'
  externalUserId?: string | null; // 平台用户ID（千牛 buyerOpenId / Web visitor_id）
  buyerNick?: string | null; // 千牛买家昵称
  platformConnectionId?: string | null; // 平台连接 ID（区分跨店铺）
}

export class CustomerService {
  constructor(private readonly customers = new CustomerRepository()) {}

  async listCustomers(filters: CustomerFilters): Promise<{
    customers: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    try {
      return await this.customers.list(filters);
    } catch (error) {
      throw toServiceError(error, '获取客户列表失败', 'DB_QUERY_ERROR');
    }
  }

  async getCustomer(id: string, limit = 10, offset = 0): Promise<{ customer: unknown; conversations: unknown[] }> {
    if (!id) {
      throw new ServiceError('缺少客户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const result = await this.customers.getWithConversations(id, limit, offset);
      if (!result.customer) {
        throw new ServiceError('客户不存在', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      return result;
    } catch (error) {
      throw toServiceError(error, '获取客户详情失败', 'DB_QUERY_ERROR');
    }
  }

  async createCustomer(input: CreateCustomerInput): Promise<unknown> {
    if (!input.name) {
      throw new ServiceError('客户姓名不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.customers.create(input);
    } catch (error) {
      throw toServiceError(error, '创建客户失败', 'DB_INSERT_ERROR');
    }
  }

  async updateCustomer(input: UpdateCustomerInput): Promise<unknown> {
    if (!input.id) {
      throw new ServiceError('缺少客户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.customers.update(input);
    } catch (error) {
      throw toServiceError(error, '更新客户失败', 'DB_UPDATE_ERROR');
    }
  }

  async deleteCustomer(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少客户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      await this.customers.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除客户失败', 'DB_DELETE_ERROR');
    }
  }

  /**
   * 根据对话信息查找或创建客户，并关联到对话。
   * 业务流程：
   * 1. 有 externalUserId → 按 platform + external_id + platform_connection_id 查找
   *    - 找到 → 自增计数 + 关联对话（幂等）
   *    - 未找到 → 创建（唯一约束兜底防并发）+ 关联对话
   *    - 并发创建冲突 → 重新查找 + 关联
   * 2. 无 externalUserId（Web 访客无 visitor_id）→ 创建匿名客户 + 关联对话
   *
   * 注意：本方法**不抛错**，仅记录错误日志。客户关联失败不应阻断对话创建。
   */
  async findOrCreateFromConversation(params: FindOrCreateFromConversationParams): Promise<{ customer: unknown; created: boolean } | null> {
    const { conversationId, source, externalUserId, buyerNick, platformConnectionId } = params;

    if (!conversationId) {
      logger.agent.warn('findOrCreateFromConversation: missing conversationId', { params });
      return null;
    }

    try {
      if (externalUserId) {
        // 路径 1: 有外部用户ID（千牛 buyerOpenId / Web visitor_id）
        const existing = await this.customers.findByExternalId(
          source,
          externalUserId,
          platformConnectionId ?? null,
        );

        if (existing) {
          // 找到回头客 → 先关联（幂等）再自增，避免关联失败但计数已增
          await this.customers.linkConversation(existing.id, conversationId);
          await this.customers.incrementConversationCount(existing.id);
          return { customer: existing, created: false };
        }

        // 创建实名客户
        const suffix = externalUserId.slice(-4).replace(/^[-_]+/, '') || '0';
        const name = buyerNick?.trim() || `访客-${suffix}`;
        let created: unknown;
        try {
          created = await this.customers.create({
            name,
            source_platform: source,
            external_id: externalUserId,
            platform_connection_id: platformConnectionId ?? null,
            is_anonymous: false,
            conversation_count: 1,
          });
        } catch (createErr: unknown) {
          // 并发场景：唯一索引冲突 → 重新查找
          const errCode = createErr instanceof RepositoryError
            ? createErr.code
            : (createErr as { code?: string })?.code;
          if (errCode === '23505') {
            const raced = await this.customers.findByExternalId(
              source,
              externalUserId,
              platformConnectionId ?? null,
            );
            if (raced) {
              await this.customers.linkConversation(raced.id, conversationId);
              await this.customers.incrementConversationCount(raced.id);
              return { customer: raced, created: false };
            }
          }
          throw createErr;
        }

        await this.customers.linkConversation(
          (created as { id: string }).id,
          conversationId,
        );
        return { customer: created, created: true };
      }

      // 路径 2: 无外部用户ID → 创建匿名客户
      const anonId = Date.now().toString(36).slice(-6);
      const created = await this.customers.create({
        name: `访客-${anonId}`,
        source_platform: source || 'web',
        external_id: null,
        platform_connection_id: null,
        is_anonymous: true,
        conversation_count: 1,
      });
      await this.customers.linkConversation(
        (created as { id: string }).id,
        conversationId,
      );
      return { customer: created, created: true };
    } catch (err) {
      logger.agent.error('findOrCreateFromConversation failed', { error: err, params });
      return null;
    }
  }

  /**
   * 为已有对话补关联客户（用于上线前已存在的对话）
   * 仅在 customer_conversations 中无记录时创建关联
   */
  async ensureCustomerLinked(params: FindOrCreateFromConversationParams): Promise<void> {
    const { conversationId, source, externalUserId, platformConnectionId } = params;
    if (!externalUserId || !conversationId) return;

    try {
      const existing = await this.customers.findByExternalId(
        source,
        externalUserId,
        platformConnectionId ?? null,
      );
      if (existing) {
        // 幂等：重复关联不会报错
        await this.customers.linkConversation(existing.id, conversationId);
      }
    } catch (err) {
      logger.agent.error('ensureCustomerLinked failed', { error: err, params: { conversationId, source, externalUserId, platformConnectionId } });
    }
  }
}
