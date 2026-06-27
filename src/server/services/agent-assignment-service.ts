import { AgentAssignmentRepository, type AgentAssignmentConfigRow, type AssignmentStrategy } from '@/server/repositories/agent-assignment-repository';
import { AgentAssignmentStatsRepository } from '@/server/repositories/agent-assignment-stats-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

// ============================================
// Types
// ============================================

export interface AssignContext {
  skillGroupId?: string | null;
  shopId?: string | null;
  platform?: string;
}

export interface AssignResult {
  success: boolean;
  agentId?: string;
  strategy?: AssignmentStrategy;
  reason?: string;
}

export interface AgentStatusInfo {
  user_id: string;
  name: string;
  email: string;
  status: 'online' | 'away' | 'offline' | 'disconnected';
  current_conversations: number;
  today_completed: number;
  today_assigned: number;
  last_active_at: string | null;
}

export interface AgentStatusSummary {
  total: number;
  online: number;
  away: number;
  offline: number;
  disconnected: number;
}

export interface ShopBindingWithDetails {
  id: string;
  shop_id: string;
  user_id: string;
  priority: number;
  is_enabled: boolean;
  shop_name?: string;
  user_name?: string;
  user_email?: string;
}

// ============================================
// Service
// ============================================

export class AgentAssignmentService {
  private readonly repo: AgentAssignmentRepository;
  private readonly statsRepo: AgentAssignmentStatsRepository;

  constructor() {
    this.repo = new AgentAssignmentRepository();
    this.statsRepo = new AgentAssignmentStatsRepository();
  }

  // ==========================================
  // Assignment Engine
  // ==========================================

  /**
   * Main entry point: assign a conversation to an available agent
   * @returns AssignResult with agentId if successful
   */
  async assignConversation(context: AssignContext): Promise<AssignResult> {
    try {
      // Get active assignment config
      const config = await this.repo.getActiveConfig();

      if (!config) {
        logger.agent.warn('No active assignment config found, fallback to legacy logic');
        return { success: false, reason: 'No active assignment config' };
      }

      // Execute assignment based on strategy
      switch (config.strategy) {
        case 'round_robin':
          return await this.roundRobinAssign(context.skillGroupId);

        case 'load_balance':
          return await this.loadBalanceAssign(context.skillGroupId);

        case 'designated_shop':
          return await this.shopDesignatedAssign(context.shopId);

        default:
          logger.agent.error('Unknown assignment strategy', { strategy: config.strategy });
          return { success: false, reason: `Unknown strategy: ${config.strategy}` };
      }
    } catch (error) {
      logger.agent.error('assignConversation failed', { error, context });
      return { success: false, reason: 'Assignment engine error' };
    }
  }

  /**
   * Round Robin: Select the agent with the earliest last_assigned_at
   */
  private async roundRobinAssign(skillGroupId: string | null | undefined): Promise<AssignResult> {
    try {
      // Get available agents for the skill group
      const agentIds = await this.repo.findAvailableAgentsForSkillGroup(skillGroupId ?? null);

      if (agentIds.length === 0) {
        logger.agent.info('No available agents for round robin', { skillGroupId });
        return { success: false, reason: 'No available agents' };
      }

      const today = new Date().toISOString().split('T')[0];

      // Batch query stats for all agents (fix N+1 query)
      const statsMap = await this.statsRepo.getStatsForUsers(agentIds, today);

      // Find agent with earliest last_assigned_at (never assigned = highest priority)
      let bestAgentId: string | null = null;
      let earliestTime: Date | null = null;

      for (const agentId of agentIds) {
        const stats = statsMap.get(agentId);

        if (!stats?.last_assigned_at) {
          // Agent never assigned today - highest priority
          bestAgentId = agentId;
          break;
        }

        const assignedTime = new Date(stats.last_assigned_at);
        if (!earliestTime || assignedTime < earliestTime) {
          earliestTime = assignedTime;
          bestAgentId = agentId;
        }
      }

      if (!bestAgentId) {
        // Fallback: pick first available agent
        bestAgentId = agentIds[0];
      }

      // Update assignment stats
      await this.statsRepo.incrementAssigned(bestAgentId);

      return {
        success: true,
        agentId: bestAgentId,
        strategy: 'round_robin',
      };
    } catch (error) {
      logger.agent.error('roundRobinAssign failed', { error, skillGroupId });
      return { success: false, reason: 'Round robin assignment failed' };
    }
  }

  /**
   * Load Balance: Select the agent with the fewest active conversations
   */
  private async loadBalanceAssign(skillGroupId: string | null | undefined): Promise<AssignResult> {
    try {
      // Get available agents for the skill group
      const agentIds = await this.repo.findAvailableAgentsForSkillGroup(skillGroupId ?? null);

      if (agentIds.length === 0) {
        logger.agent.info('No available agents for load balance', { skillGroupId });
        return { success: false, reason: 'No available agents' };
      }

      const today = new Date().toISOString().split('T')[0];

      // Batch query stats for all agents (fix N+1 query)
      const statsMap = await this.statsRepo.getStatsForUsers(agentIds, today);

      let bestAgentId: string | null = null;
      let minActive = Number.MAX_SAFE_INTEGER;

      for (const agentId of agentIds) {
        const stats = statsMap.get(agentId);
        const activeCount = stats?.active_conversations ?? 0;

        if (activeCount < minActive) {
          minActive = activeCount;
          bestAgentId = agentId;
        }
      }

      if (!bestAgentId) {
        bestAgentId = agentIds[0];
      }

      // Update assignment stats
      await this.statsRepo.incrementAssigned(bestAgentId);

      return {
        success: true,
        agentId: bestAgentId,
        strategy: 'load_balance',
      };
    } catch (error) {
      logger.agent.error('loadBalanceAssign failed', { error, skillGroupId });
      return { success: false, reason: 'Load balance assignment failed' };
    }
  }

  /**
   * Designated Shop: Find the agent bound to the specific shop
   */
  private async shopDesignatedAssign(shopId: string | null | undefined): Promise<AssignResult> {
    if (!shopId) {
      logger.agent.info('No shop_id provided for designated shop assignment');
      return { success: false, reason: 'No shop specified' };
    }

    try {
      const agentId = await this.repo.findBestAgentForShop(shopId);

      if (!agentId) {
        logger.agent.info('No available agent for shop', { shopId });
        return { success: false, reason: 'No available agent for this shop' };
      }

      // Update assignment stats
      await this.statsRepo.incrementAssigned(agentId);

      return {
        success: true,
        agentId,
        strategy: 'designated_shop',
      };
    } catch (error) {
      logger.agent.error('shopDesignatedAssign failed', { error, shopId });
      return { success: false, reason: 'Designated shop assignment failed' };
    }
  }

  // ==========================================
  // Config Management
  // ==========================================

  async listConfigs(): Promise<AgentAssignmentConfigRow[]> {
    try {
      return await this.repo.listConfigs();
    } catch (error) {
      throw toServiceError(error, '获取分配配置列表失败', 'DB_ERROR');
    }
  }

  async getActiveConfig(): Promise<AgentAssignmentConfigRow | null> {
    try {
      return await this.repo.getActiveConfig();
    } catch (error) {
      throw toServiceError(error, '获取当前分配配置失败', 'DB_ERROR');
    }
  }

  async createConfig(input: {
    strategy: AssignmentStrategy;
    name: string;
    is_enabled?: boolean;
    condition_config?: Record<string, unknown>;
  }): Promise<AgentAssignmentConfigRow> {
    if (!input.name || !input.strategy) {
      throw new ServiceError('名称和策略为必填项', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      return await this.repo.createConfig({
        strategy: input.strategy,
        name: input.name,
        is_enabled: input.is_enabled,
        condition_config: input.condition_config,
      });
    } catch (error) {
      throw toServiceError(error, '创建分配配置失败', 'DB_ERROR');
    }
  }

  async updateConfig(input: {
    id: string;
    strategy?: AssignmentStrategy;
    name?: string;
    is_enabled?: boolean;
    condition_config?: Record<string, unknown>;
  }): Promise<AgentAssignmentConfigRow> {
    if (!input.id) {
      throw new ServiceError('缺少配置ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      return await this.repo.updateConfig({
        id: input.id,
        strategy: input.strategy,
        name: input.name,
        is_enabled: input.is_enabled,
        condition_config: input.condition_config,
      });
    } catch (error) {
      throw toServiceError(error, '更新分配配置失败', 'DB_ERROR');
    }
  }

  async deleteConfig(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少配置ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.deleteConfig(id);
    } catch (error) {
      throw toServiceError(error, '删除分配配置失败', 'DB_ERROR');
    }
  }

  // ==========================================
  // Shop Bindings Management
  // ==========================================

  async listShopBindings(filters?: { shop_id?: string; user_id?: string }): Promise<ShopBindingWithDetails[]> {
    try {
      return await this.repo.listShopBindings(filters) as ShopBindingWithDetails[];
    } catch (error) {
      throw toServiceError(error, '获取店铺绑定列表失败', 'DB_ERROR');
    }
  }

  async createShopBinding(input: {
    shop_id: string;
    user_id: string;
    priority?: number;
    is_enabled?: boolean;
  }): Promise<{ binding: { id: string } }> {
    if (!input.shop_id || !input.user_id) {
      throw new ServiceError('店铺ID和坐席ID为必填项', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const binding = await this.repo.createShopBinding({
        shop_id: input.shop_id,
        user_id: input.user_id,
        priority: input.priority,
        is_enabled: input.is_enabled,
      });
      return { binding };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // Handle duplicate binding error
      const errorRecord = error as Record<string, unknown>;
      if (errorRecord.code === 'DUPLICATE_BINDING') {
        throw new ServiceError('该店铺和坐席的绑定已存在', { status: 409, code: 'DUPLICATE_BINDING' });
      }
      throw toServiceError(error, '创建店铺绑定失败', 'DB_ERROR');
    }
  }

  async deleteShopBinding(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少绑定ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.deleteShopBinding(id);
    } catch (error) {
      throw toServiceError(error, '删除店铺绑定失败', 'DB_ERROR');
    }
  }

  // ==========================================
  // Agent Status
  // ==========================================

  async getAllAgentsStatus(): Promise<{
    agents: AgentStatusInfo[];
    summary: AgentStatusSummary;
  }> {
    try {
      console.log('[DEBUG] getAllAgentsStatus called');
      const result = await this.statsRepo.getAllAgentsStatus();
      console.log('[DEBUG] getAllAgentsStatus result:', JSON.stringify(result));
      return {
        agents: result.agents as AgentStatusInfo[],
        summary: result.summary,
      };
    } catch (error) {
      console.error('[DEBUG] getAllAgentsStatus error:', error);
      throw toServiceError(error, '获取坐席状态失败', 'DB_ERROR');
    }
  }

  // ==========================================
  // Stats Sync (called by agent-service)
  // ==========================================

  async onAgentAccept(agentId: string): Promise<void> {
    try {
      await this.statsRepo.incrementActiveConversations(agentId);
      logger.agent.info('Agent accept: incremented active conversations', { agentId });
    } catch (error) {
      logger.agent.error('onAgentAccept sync failed', { error, agentId });
    }
  }

  async onAgentResolve(agentId: string): Promise<void> {
    try {
      await this.statsRepo.decrementActiveConversations(agentId);
      await this.statsRepo.incrementCompleted(agentId);
      logger.agent.info('Agent resolve: decremented active, incremented completed', { agentId });
    } catch (error) {
      logger.agent.error('onAgentResolve sync failed', { error, agentId });
    }
  }

  async onAgentTransfer(fromAgentId: string, toAgentId: string): Promise<void> {
    try {
      await this.statsRepo.decrementActiveConversations(fromAgentId);
      await this.statsRepo.incrementActiveConversations(toAgentId);
      logger.agent.info('Agent transfer: decremented from, incremented to', { fromAgentId, toAgentId });
    } catch (error) {
      logger.agent.error('onAgentTransfer sync failed', { error, fromAgentId, toAgentId });
    }
  }
}
