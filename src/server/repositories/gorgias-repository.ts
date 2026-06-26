/**
 * Gorgias Repository
 * 数据访问层，负责与 Gorgias API 交互并缓存结果
 */

import { getLogger } from '@/lib/logger';
import { createGorgiasClient, GorgiasClient, type GorgiasTicket, type GorgiasMessage, type GorgiasCustomer, type GorgiasUser, type GorgiasTag, type GorgiasHttpIntegration } from '@/lib/gorgias-client';

// Re-export types for convenience
export type { GorgiasTicket, GorgiasMessage, GorgiasCustomer, GorgiasUser, GorgiasTag, GorgiasHttpIntegration };

const logger = getLogger('GorgiasRepository');

interface CachedItem<T> {
  data: T;
  timestamp: number;
}

interface CacheConfig {
  ttl: number; // 毫秒
  maxSize: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 5 * 60 * 1000, // 5分钟
  maxSize: 100,
};

export class GorgiasRepository {
  private client: GorgiasClient | null = null;
  private cache: Map<string, CachedItem<unknown>> = new Map();
  private cacheConfig: CacheConfig;

  constructor(cacheConfig?: Partial<CacheConfig>) {
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };
    this.cleanupCache();
  }

  /**
   * 初始化客户端
   */
  async init(): Promise<boolean> {
    if (this.client) return true;

    try {
      this.client = await createGorgiasClient();
      
      if (!this.client) {
        logger.debug('Gorgias client not available (not configured)');
        return false;
      }

      const connected = await this.client.testConnection();
      if (connected) {
        logger.info('Gorgias client connected successfully');
        return true;
      } else {
        logger.warn('Gorgias client connection test failed');
        this.client = null;
        return false;
      }
    } catch (err) {
      logger.error('Failed to initialize Gorgias client', { error: err instanceof Error ? err.message : 'Unknown' });
      this.client = null;
      return false;
    }
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * 获取缓存键
   */
  private getCacheKey(prefix: string, id?: string | number): string {
    return id ? `${prefix}:${id}` : prefix;
  }

  /**
   * 从缓存获取
   */
  private getFromCache<T>(key: string): T | null {
    const item = this.cache.get(key) as CachedItem<T> | undefined;
    
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.cacheConfig.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  /**
   * 设置缓存
   */
  private setCache<T>(key: string, data: T): void {
    if (this.cache.size >= this.cacheConfig.maxSize) {
      // 删除最老的缓存项
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.cacheConfig.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取工单列表
   */
  async getTickets(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
    assignee_user?: number;
    tag_id?: number;
  }): Promise<{
    data: GorgiasTicket[];
    has_more: boolean;
    cursor: string | null;
  }> {
    if (!await this.init()) {
      return { data: [], has_more: false, cursor: null };
    }

    const cacheKey = this.getCacheKey('tickets', JSON.stringify(params || {}));
    const cached = this.getFromCache<{ data: GorgiasTicket[]; has_more: boolean; cursor: string | null }>(cacheKey);
    
    if (cached) {
      logger.debug('Returning cached tickets');
      return cached;
    }

    try {
      const response = await this.client!.getTickets(params);
      const result = {
        data: response.data || [],
        has_more: response.has_more,
        cursor: response.cursor || null,
      };
      
      this.setCache(cacheKey, result);
      return result;
    } catch (err) {
      logger.error('Failed to get tickets', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 获取单个工单
   */
  async getTicket(ticketId: number): Promise<GorgiasTicket | null> {
    if (!await this.init()) {
      return null;
    }

    const cacheKey = this.getCacheKey('ticket', ticketId);
    const cached = this.getFromCache<GorgiasTicket>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const ticket = await this.client!.getTicket(ticketId);
      this.setCache(cacheKey, ticket);
      return ticket;
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
    data: GorgiasMessage[];
    has_more: boolean;
    cursor: string | null;
  }> {
    if (!await this.init()) {
      return { data: [], has_more: false, cursor: null };
    }

    const cacheKey = this.getCacheKey('messages', `${ticketId}:${JSON.stringify(params || {})}`);
    const cached = this.getFromCache<{ data: GorgiasMessage[]; has_more: boolean; cursor: string | null }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client!.getTicketMessages(ticketId, params);
      const result = {
        data: response.data || [],
        has_more: response.has_more,
        cursor: response.cursor || null,
      };
      
      this.setCache(cacheKey, result);
      return result;
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
    data: GorgiasMessage[];
    has_more: boolean;
    cursor: string | null;
  }> {
    if (!await this.init()) {
      return { data: [], has_more: false, cursor: null };
    }

    const cacheKey = this.getCacheKey('messages:all', JSON.stringify(params || {}));
    const cached = this.getFromCache<{ data: GorgiasMessage[]; has_more: boolean; cursor: string | null }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client!.getMessages(params);
      const result = {
        data: response.data || [],
        has_more: response.has_more,
        cursor: response.cursor || null,
      };
      
      this.setCache(cacheKey, result);
      return result;
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
    data: GorgiasCustomer[];
    has_more: boolean;
    cursor: string | null;
  }> {
    if (!await this.init()) {
      return { data: [], has_more: false, cursor: null };
    }

    const cacheKey = this.getCacheKey('customers', JSON.stringify(params || {}));
    const cached = this.getFromCache<{ data: GorgiasCustomer[]; has_more: boolean; cursor: string | null }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client!.getCustomers(params);
      const result = {
        data: response.data || [],
        has_more: response.has_more,
        cursor: response.cursor || null,
      };
      
      this.setCache(cacheKey, result);
      return result;
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
    data: GorgiasUser[];
    has_more: boolean;
    cursor: string | null;
  }> {
    if (!await this.init()) {
      return { data: [], has_more: false, cursor: null };
    }

    const cacheKey = this.getCacheKey('users', JSON.stringify(params || {}));
    const cached = this.getFromCache<{ data: GorgiasUser[]; has_more: boolean; cursor: string | null }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client!.getUsers(params);
      const result = {
        data: response.data || [],
        has_more: response.has_more,
        cursor: response.cursor || null,
      };
      
      this.setCache(cacheKey, result);
      return result;
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
    data: GorgiasTag[];
    has_more: boolean;
    cursor: string | null;
  }> {
    if (!await this.init()) {
      return { data: [], has_more: false, cursor: null };
    }

    const cacheKey = this.getCacheKey('tags', JSON.stringify(params || {}));
    const cached = this.getFromCache<{ data: GorgiasTag[]; has_more: boolean; cursor: string | null }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client!.getTags(params);
      const result = {
        data: response.data || [],
        has_more: response.has_more,
        cursor: response.cursor || null,
      };
      
      this.setCache(cacheKey, result);
      return result;
    } catch (err) {
      logger.error('Failed to get tags', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Gorgias cache cleared');
  }

  /**
   * 重置客户端（设置变更后调用，强制下次 init() 重新创建客户端）
   */
  resetClient(): void {
    this.client = null;
    this.cache.clear();
    logger.info('Gorgias client and cache reset');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.cacheConfig.maxSize,
      ttl: this.cacheConfig.ttl,
    };
  }

  /**
   * 获取 SmartAssist Webhook Integration
   * 
   * 使用 type=http 过滤，避免返回大量非 HTTP 集成；
   * 使用 cursor 分页遍历所有结果，确保不遗漏；
   * 优先精确匹配 name === 'SmartAssist Webhook'，
   * 也支持通过 URL 匹配（用户可能手动创建了不同名称的 Integration）
   */
  async getWebhookIntegration(webhookUrl?: string): Promise<GorgiasHttpIntegration | null> {
    if (!await this.init()) {
      return null;
    }

    try {
      // Gorgias API 使用 cursor 分页，需遍历所有页面
      let cursor: string | undefined = undefined;
      let hasMore = true;
      
      while (hasMore) {
        const queryParams: Record<string, unknown> = { type: 'http', limit: 100 };
        if (cursor) {
          queryParams.cursor = cursor;
        }
        
        const response = await this.client!.get<{ data: GorgiasHttpIntegration[]; has_more: boolean; meta?: { next_cursor?: string } }>('/integrations', queryParams);
        const integrations = response.data || [];
        
        // 精确匹配 SmartAssist Webhook（不再用 i.type === 'http' 宽泛匹配）
        // 也支持通过 URL 匹配（用户可能手动创建了不同名称的 Integration）
        // 匹配时提取基础 URL 和 secret/ticket_id 参数
        const webhookUrlLower = webhookUrl?.toLowerCase();
        
        const parseWebhookUrl = (url: string) => {
          try {
            const u = new URL(url.toLowerCase());
            return {
              base: `${u.origin}${u.pathname}`,
              secret: u.searchParams.get('secret'),
              ticketId: u.searchParams.get('ticket_id'),
            };
          } catch {
            return null;
          }
        };
        
        const targetParsed = webhookUrlLower ? parseWebhookUrl(webhookUrlLower) : null;
        
        const found = integrations.find((i: any) => {
          // 1. 名称精确匹配
          if (i.name === 'SmartAssist Webhook') return true;
          
          // 2. URL 匹配（支持带参数或模板变量的 URL）
          if (targetParsed && i.http?.url) {
            const storedParsed = parseWebhookUrl(i.http.url);
            if (storedParsed) {
              // 基础 URL 必须匹配
              if (storedParsed.base !== targetParsed.base) return false;
              // secret 参数必须匹配（如果有的话）
              if (targetParsed.secret && storedParsed.secret !== targetParsed.secret) return false;
              return true;
            }
          }
          return false;
        });
        if (found) {
          return found;
        }
        
        hasMore = response.has_more;
        cursor = response.meta?.next_cursor || undefined;
      }
      
      return null;
    } catch (err) {
      logger.error('Failed to get webhook integration', { error: err instanceof Error ? err.message : 'Unknown' });
      return null;
    }
  }

  /**
   * 创建 Webhook Integration
   * 
   * Gorgias API 文档要求：
   * - http.name 是必填字段（在 http 对象内部）
   * - http.url 是回调 URL
   * - http.triggers 定义事件触发器
   * - 不支持 method/headers/request_content_type/response_content_type/oauth2 字段
   */
  async createWebhookIntegration(webhookUrl: string): Promise<number> {
    if (!await this.init()) {
      throw new Error('Gorgias client not available');
    }

    try {
      const requestBody = {
        type: 'http',
        name: 'SmartAssist Webhook',
        http: {
          url: webhookUrl,
          triggers: {
            'ticket-created': true,
            'ticket-updated': true,
            'ticket-message-created': true,
            'ticket-self-unsnoozed': false,
            'ticket-message-failed': false,
            'ticket-assignment-updated': false,
            'ticket-status-updated': false,
            'ticket-handed-over': true,
          },
        },
      };

      logger.info('Creating Gorgias webhook integration', { 
        url: webhookUrl,
        body: JSON.stringify(requestBody)
      });

      const response = await this.client!.post<{ id: number }>('/integrations', requestBody);

      logger.info('Created Gorgias webhook integration', { integrationId: response.id });
      return response.id;
    } catch (err) {
      const errorDetail = err instanceof Error 
        ? { message: err.message, status: (err as any).status, statusText: (err as any).statusText }
        : { message: String(err) };
      logger.error('Failed to create webhook integration', errorDetail);
      throw err;
    }
  }

  /**
   * 更新 Webhook Integration URL
   */
  async updateWebhookIntegration(integrationId: number, webhookUrl: string): Promise<void> {
    if (!await this.init()) {
      throw new Error('Gorgias client not available');
    }

    try {
      // NOTE: 不包含 name 字段（name 只能在创建时设置，Gorgias 不接受 http.name）
      await this.client!.put(`/integrations/${integrationId}`, {
        type: 'http',
        http: {
          url: webhookUrl,
          triggers: {
            'ticket-created': true,
            'ticket-updated': true,
            'ticket-message-created': true,
            'ticket-self-unsnoozed': false,
            'ticket-message-failed': false,
            'ticket-assignment-updated': false,
            'ticket-status-updated': false,
            'ticket-handed-over': true,
          },
        },
      });

      logger.info('Updated Gorgias webhook integration', { integrationId });
    } catch (err) {
      logger.error('Failed to update webhook integration', { integrationId, error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  /**
   * 删除 Webhook Integration
   */
  async deleteWebhookIntegration(integrationId: number): Promise<void> {
    if (!await this.init()) {
      throw new Error('Gorgias client not available');
    }

    try {
      await this.client!.delete(`/integrations/${integrationId}`);
      logger.info('Deleted Gorgias webhook integration', { integrationId });
    } catch (err) {
      logger.error('Failed to delete webhook integration', { integrationId, error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }
}

// 导出单例
export const gorgiasRepository = new GorgiasRepository();
