/**
 * Gorgias Service
 * 业务逻辑层，封装 Repository 操作，提供标准化的数据格式
 */

import { getLogger } from '@/lib/logger';
import { gorgiasRepository, type GorgiasTicket, type GorgiasMessage, type GorgiasCustomer, type GorgiasUser, type GorgiasTag } from '@/server/repositories/gorgias-repository';

const logger = getLogger('GorgiasService');

export interface NormalizedTicket {
  id: number;
  externalId: string | null;
  subject: string;
  status: 'open' | 'pending' | 'solved' | 'closed' | 'spam' | 'trashed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  channel: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  tags: string[];
  messagesCount: number;
  isUnread: boolean;
  createdAt: string;
  openedAt: string | null;
  lastReceivedMessageAt: string | null;
  closedAt: string | null;
  satisfaction: {
    rating: 'good' | 'bad' | null;
    note: string | null;
  } | null;
}

export interface NormalizedMessage {
  id: number;
  ticketId: number;
  channel: string;
  authorType: 'customer' | 'user' | 'channel' | 'system';
  authorName: string;
  authorEmail: string;
  body: string;
  plainBody: string;
  subject: string | null;
  createdAt: string;
  isFromAgent: boolean;
}

export interface NormalizedCustomer {
  id: number;
  hash: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  companyName: string | null;
  language: string;
  createdAt: string;
}

export interface NormalizedUser {
  id: number;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  active: boolean;
  admin: boolean;
  role: string;
  avatarUrl: string | null;
}

export interface NormalizedTag {
  id: number;
  name: string;
  color: string;
}

export interface TicketListParams {
  limit?: number;
  cursor?: string;
  status?: string;
  assignee_user?: number;
  tag_id?: number;
  created_after?: string;
  created_before?: string;
}

export interface TicketListResult {
  tickets: NormalizedTicket[];
  hasMore: boolean;
  cursor: string | null;
}

/**
 * 将原始工单数据标准化
 */
function normalizeTicket(ticket: GorgiasTicket): NormalizedTicket {
  return {
    id: ticket.id,
    externalId: ticket.external_id,
    subject: ticket.subject || '(无主题)',
    status: ticket.status,
    priority: ticket.priority,
    channel: ticket.channel,
    customerId: ticket.customer?.id || 0,
    customerName: ticket.customer?.name || 'Unknown',
    customerEmail: ticket.customer?.email || '',
    assigneeUserId: ticket.assignee_user,
    assigneeTeamId: ticket.assignee_team,
    tags: ticket.tags?.map(t => t.name) || [],
    messagesCount: ticket.messages_count,
    isUnread: ticket.is_unread,
    createdAt: ticket.created_datetime,
    openedAt: ticket.opened_datetime,
    lastReceivedMessageAt: ticket.last_received_message_datetime,
    closedAt: ticket.closed_datetime,
    satisfaction: ticket.satisfaction ? {
      rating: ticket.satisfaction.rating,
      note: ticket.satisfaction.note,
    } : null,
  };
}

/**
 * 将原始消息数据标准化
 */
function normalizeMessage(message: GorgiasMessage): NormalizedMessage {
  // 判断是否来自坐席（基于 author type 或 via/source 字段）
  const isFromAgent = 
    message.author?.type === 'user' || 
    message.author?.type === 'channel' ||
    message.via?.source?.type === 'agent' ||
    message.from_agent === true;

  return {
    id: message.id,
    ticketId: message.ticket_id,
    channel: message.channel,
    authorType: message.author?.type || 'customer',
    authorName: message.author?.name || 'Unknown',
    authorEmail: message.author?.email || '',
    body: message.body || '',
    plainBody: message.plain_body || message.body_text || '',
    subject: message.subject || null,
    createdAt: message.created_datetime,
    isFromAgent,
  };
}

/**
 * 将原始客户数据标准化
 */
function normalizeCustomer(customer: GorgiasCustomer): NormalizedCustomer {
  return {
    id: customer.id,
    hash: customer.hash,
    email: customer.email,
    name: customer.name || 'Unknown',
    firstName: customer.firstname,
    lastName: customer.lastname,
    phoneNumber: customer.phone_number,
    companyName: customer.company?.name || null,
    language: customer.language,
    createdAt: customer.created_datetime,
  };
}

/**
 * 将原始用户数据标准化
 */
function normalizeUser(user: GorgiasUser): NormalizedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || 'Unknown',
    firstName: user.firstname,
    lastName: user.lastname,
    active: user.active,
    admin: user.admin,
    role: user.role,
    avatarUrl: user.avatar_url,
  };
}

/**
 * 将原始标签数据标准化
 */
function normalizeTag(tag: GorgiasTag): NormalizedTag {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
  };
}

class GorgiasService {
  /**
   * 检查服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    return gorgiasRepository.isAvailable();
  }

  /**
   * 获取 Gorgias 设置
   */
  async getSettings(): Promise<{
    enabled: boolean;
    syncEnabled: boolean;
    domain: string;
    email: string;
    webhookEnabled: boolean;
    webhookUrl: string | null;
    webhookSecret: string | null;
  }> {
    const enabled = await gorgiasRepository.isAvailable();
    
    if (!enabled) {
      return {
        enabled: false,
        syncEnabled: false,
        domain: '',
        email: '',
        webhookEnabled: false,
        webhookUrl: null,
        webhookSecret: null,
      };
    }
    
    // 从 settings 表读取配置
    const { SettingsRepository } = await import('../repositories/settings-repository');
    const settingsRepo = new SettingsRepository();
    const [domain, email, syncEnabledStr] = await Promise.all([
      settingsRepo.get('gorgias_domain'),
      settingsRepo.get('gorgias_email'),
      settingsRepo.get('gorgias_sync_enabled'),
    ]);
    
    const webhookUrl = await this.getWebhookUrl();
    const webhookSecret = await this.getWebhookSecret();
    const webhookStatus = await this.getWebhookStatus(webhookUrl || undefined);
    
    return {
      enabled: true,
      syncEnabled: syncEnabledStr === 'true',
      domain: domain || '',
      email: email || '',
      webhookEnabled: webhookStatus.enabled,
      webhookUrl: webhookUrl || null,
      webhookSecret: webhookSecret || null,
    };
  }

  /**
   * 获取工单列表
   */
  async getTickets(params?: TicketListParams): Promise<TicketListResult> {
    try {
      const result = await gorgiasRepository.getTickets(params);
      return {
        tickets: result.data.map(normalizeTicket),
        hasMore: result.has_more,
        cursor: result.cursor,
      };
    } catch (err) {
      logger.error('Failed to get tickets', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取单个工单
   */
  async getTicket(ticketId: number): Promise<NormalizedTicket | null> {
    try {
      const ticket = await gorgiasRepository.getTicket(ticketId);
      return ticket ? normalizeTicket(ticket) : null;
    } catch (err) {
      logger.error('Failed to get ticket', { ticketId, error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取工单消息
   */
  async getTicketMessages(ticketId: number, params?: {
    limit?: number;
    cursor?: string;
  }): Promise<{
    messages: NormalizedMessage[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    try {
      const result = await gorgiasRepository.getTicketMessages(ticketId, params);
      return {
        messages: result.data.map(normalizeMessage),
        hasMore: result.has_more,
        cursor: result.cursor,
      };
    } catch (err) {
      logger.error('Failed to get ticket messages', { ticketId, error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取消息列表
   */
  async getMessages(params?: {
    limit?: number;
    cursor?: string;
    sender_id?: number;
    channel?: string;
  }): Promise<{
    messages: NormalizedMessage[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    try {
      const result = await gorgiasRepository.getMessages(params);
      return {
        messages: result.data.map(normalizeMessage),
        hasMore: result.has_more,
        cursor: result.cursor,
      };
    } catch (err) {
      logger.error('Failed to get messages', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取客户列表
   */
  async getCustomers(params?: {
    limit?: number;
    cursor?: string;
    name?: string;
    email?: string;
  }): Promise<{
    customers: NormalizedCustomer[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    try {
      const result = await gorgiasRepository.getCustomers(params);
      return {
        customers: result.data.map(normalizeCustomer),
        hasMore: result.has_more,
        cursor: result.cursor,
      };
    } catch (err) {
      logger.error('Failed to get customers', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取坐席用户列表
   */
  async getUsers(params?: {
    limit?: number;
    cursor?: string;
    active?: boolean;
  }): Promise<{
    users: NormalizedUser[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    try {
      const result = await gorgiasRepository.getUsers(params);
      return {
        users: result.data.map(normalizeUser),
        hasMore: result.has_more,
        cursor: result.cursor,
      };
    } catch (err) {
      logger.error('Failed to get users', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取标签列表
   */
  async getTags(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<{
    tags: NormalizedTag[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    try {
      const result = await gorgiasRepository.getTags(params);
      return {
        tags: result.data.map(normalizeTag),
        hasMore: result.has_more,
        cursor: result.cursor,
      };
    } catch (err) {
      logger.error('Failed to get tags', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取连接状态
   */
  async getConnectionStatus(): Promise<{
    available: boolean;
    cacheStats: { size: number; maxSize: number; ttl: number };
  }> {
    const available = await this.isAvailable();
    return {
      available,
      cacheStats: gorgiasRepository.getCacheStats(),
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    gorgiasRepository.clearCache();
  }

  /**
   * 获取 Webhook Secret
   */
  async getWebhookSecret(): Promise<string> {
    const { getSupabaseClient, isDemoMode } = await import('@/storage/database/supabase-client');
    
    if (isDemoMode()) {
      return 'demo-secret';
    }
    
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'gorgias_webhook_secret')
      .single();
    
    if (data?.value) {
      return data.value;
    }
    
    // 如果没有设置，生成一个新的
    const secret = this.generateWebhookSecret();
    await supabase
      .from('settings')
      .upsert({ key: 'gorgias_webhook_secret', value: secret });
    
    return secret;
  }

  /**
   * 生成 Webhook Secret
   */
  private generateWebhookSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 获取 Webhook 配置状态
   * @param webhookUrl 可选，用于通过 URL 匹配 Integration（当 name 不匹配时）
   */
  async getWebhookStatus(webhookUrl?: string): Promise<{
    enabled: boolean;
    integrationId: number | null;
    integrationUrl: string | null;
    triggers: {
      ticket_created: boolean;
      ticket_updated: boolean;
      ticket_message_created: boolean;
      ticket_handed_over: boolean;
    };
  }> {
    // 直接检查 Gorgias 是否可用，避免调用 this.getSettings() 导致无限递归
    const enabled = gorgiasRepository.isAvailable();

    if (!enabled) {
      return {
        enabled: false,
        integrationId: null,
        integrationUrl: null,
        triggers: {
          ticket_created: false,
          ticket_updated: false,
          ticket_message_created: false,
          ticket_handed_over: false,
        },
      };
    }
    
    try {
      const integration = await gorgiasRepository.getWebhookIntegration(webhookUrl);
      
      if (!integration) {
        return {
          enabled: true,
          integrationId: null,
          integrationUrl: null,
          triggers: {
            ticket_created: false,
            ticket_updated: false,
            ticket_message_created: false,
            ticket_handed_over: false,
          },
        };
      }
      
      return {
        enabled: true,
        integrationId: integration.id,
        integrationUrl: integration.http.url,
        triggers: {
          ticket_created: integration.http.triggers['ticket-created'],
          ticket_updated: integration.http.triggers['ticket-updated'],
          ticket_message_created: integration.http.triggers['ticket-message-created'],
          ticket_handed_over: integration.http.triggers['ticket-handed-over'],
        },
      };
    } catch (err) {
      logger.error('Failed to get webhook status', { error: err instanceof Error ? err.message : 'Unknown' });
      return {
        enabled: false,
        integrationId: null,
        integrationUrl: null,
        triggers: {
          ticket_created: false,
          ticket_updated: false,
          ticket_message_created: false,
          ticket_handed_over: false,
        },
      };
    }
  }

  /**
   * 注册 Webhook Integration
   * 
   * @param webhookUrl Webhook 目标 URL（不含 secret 参数）
   */
  async registerWebhook(webhookUrl: string): Promise<{
    success: boolean;
    integrationId?: number;
    secret?: string;
    error?: string;
  }> {
    try {
      // 检查 Gorgias 客户端是否可用
      const available = gorgiasRepository.isAvailable();
      if (!available) {
        // 尝试初始化
        const initResult = await gorgiasRepository.init();
        if (!initResult) {
          const errMsg = 'Gorgias client not available - check domain/email/apiKey settings';
          logger.error('Webhook registration failed: client not available');
          return { success: false, error: errMsg };
        }
      }
      
      // 先尝试获取已有的 integration（按 name 或 URL 匹配）
      const existing = await gorgiasRepository.getWebhookIntegration(webhookUrl);
      
      if (existing) {
        // 更新现有 integration
        logger.info('Updating existing Gorgias webhook integration', { integrationId: existing.id });
        await gorgiasRepository.updateWebhookIntegration(existing.id, webhookUrl);
        return {
          success: true,
          integrationId: existing.id,
        };
      }
      
      // 创建新的 integration
      logger.info('Creating new Gorgias webhook integration', { webhookUrl });
      const integrationId = await gorgiasRepository.createWebhookIntegration(webhookUrl);
      
      return {
        success: true,
        integrationId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to register webhook';
      logger.error('Failed to register webhook', { error: errorMsg });
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 删除 Webhook Integration
   */
  async deleteWebhook(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const integration = await gorgiasRepository.getWebhookIntegration();
      
      if (integration) {
        await gorgiasRepository.deleteWebhookIntegration(integration.id);
      }
      
      return { success: true };
    } catch (err) {
      logger.error('Failed to delete webhook', { error: err instanceof Error ? err.message : 'Unknown' });
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete webhook',
      };
    }
  }

  /**
   * Get webhook URL (with secret)
   */
  async getWebhookUrl(): Promise<string | null> {
    const { isDemoMode } = await import('@/storage/database/supabase-client');
    
    if (isDemoMode()) {
      return null;
    }
    
    // Check if Gorgias is available to avoid infinite recursion
    const enabled = gorgiasRepository.isAvailable();
    if (!enabled) {
      return null;
    }
    
    const secret = await this.getWebhookSecret();
    
    // Need a publicly accessible URL
    const baseUrl = process.env.SMARTASSIST_PUBLIC_URL || 'https://your-domain.com';
    
    // Gorgias template variable {{ticket.id}} will be replaced when sending
    return `${baseUrl}/api/gorgias/webhook?secret=${secret}&ticket_id={{ticket.id}}`;
  }
}

// Export singleton
export const gorgiasService = new GorgiasService();
