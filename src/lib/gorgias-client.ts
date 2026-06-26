/**
 * Gorgias API HTTP Client
 * 基于 Basic Auth (Email + API Key) 进行认证
 * API 文档: https://developers.gorgias.com/
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasClient');

export interface GorgiasConfig {
  domain: string;
  email: string;
  apiKey: string;
}

export interface GorgiasTicket {
  id: number;
  uri: string;
  external_id: string | null;
  language: string | null;
  status: 'open' | 'pending' | 'solved' | 'closed' | 'spam' | 'trashed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  channel: string;
  via: string;
  from_agent: boolean;
  customer: {
    id: number;
    email: string;
    name: string;
    firstname: string | null;
    lastname: string | null;
  };
  assignee_user: number | null;
  assignee_team: number | null;
  subject: string;
  summary: string | null;
  excerpt: string | null;
  integrations: unknown[];
  meta: unknown | null;
  tags: Array<{
    id: number;
    name: string;
    decoration: Record<string, unknown>;
  }>;
  messages_count: number;
  is_unread: boolean;
  spam: boolean;
  created_datetime: string;
  opened_datetime: string | null;
  last_received_message_datetime: string | null;
  last_message_datetime: string | null;
  closed_datetime: string | null;
  snoozed_datetime: string | null;
  satisfaction: {
    id: number;
    rating: 'good' | 'bad' | null;
    user_id: number | null;
    note: string | null;
    created_datetime: string | null;
  } | null;
  // messages 可能包含在工单响应中（Webhook 推送时），也可能需要单独获取
  messages?: GorgiasMessage[];
}

export interface GorgiasMessage {
  id: number;
  uri: string;
  ticket_id: number;
  channel: string;
  author: {
    id: number;
    type: 'customer' | 'user' | 'channel' | 'system';
    name: string;
    email: string;
  };
  body: string;
  body_text: string;
  plain_body: string;
  html_body: string;
  subject: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  created_datetime: string;
  received_datetime: string;
  source: {
    type: string;
    from: string;
  };
  // via 字段：包含消息来源信息（用于判断是否来自坐席）
  via?: {
    channel?: string;
    source?: {
      type?: string;
      from?: string;
    };
  };
  // from_agent 标志：直接标识消息是否来自坐席
  from_agent?: boolean;
  attached_images: unknown[];
  attachments: unknown[];
  meta: unknown | null;
  channels: string[];
  events: unknown[];
}

export interface GorgiasCustomer {
  id: number;
  hash: string;
  email: string;
  name: string;
  firstname: string | null;
  lastname: string | null;
  phone_number: string | null;
  company: {
    id: number;
    name: string;
    logo?: string;
  } | null;
  language: string;
  timezone: string;
  created_datetime: string;
  updated_datetime: string;
  metadata: Record<string, unknown>;
}

export interface GorgiasUser {
  id: number;
  email: string;
  name: string;
  firstname: string;
  lastname: string;
  active: boolean;
  admin: boolean;
  super_admin: boolean;
  role: string;
  avatar_url: string | null;
  language: string;
  timezone: string;
  created_datetime: string;
  last_login_datetime: string | null;
}

export interface GorgiasTag {
  id: number;
  name: string;
  color: string;
  created_datetime: string;
  update_datetime: string;
}

/**
 * Gorgias Webhook 事件类型
 *
 * Gorgias HTTP Integration 推送的事件结构：
 * {
 *   "id": 1897045193,
 *   "type": "ticket-message-created",
 *   "object_id": 68211294,
 *   "object_type": "Ticket",
 *   "created_datetime": "2026-06-23T06:12:37.100676+00:00",
 *   "data": {
 *     "ticket": { ticket object with messages array }
 *   }
 * }
 */

export type GorgiasWebhookEventType = 
  | 'ticket-created'
  | 'ticket-message-created'
  | 'ticket-updated'
  | 'ticket-self-unsnoozed'
  | 'ticket-message-failed'
  | 'ticket-handed-over';

export interface GorgiasWebhookEvent {
  /** 事件唯一 ID */
  id: number;
  /** 事件类型 */
  type: GorgiasWebhookEventType;
  /** 关联对象 ID（如工单 ID） */
  object_id: number;
  /** 关联对象类型（通常为 Ticket） */
  object_type: 'Ticket';
  /** 事件创建时间 */
  created_datetime: string;
  /** 事件数据（包含完整工单信息，Webhook body 为空时可能缺失） */
  data: {
    ticket?: GorgiasTicket;
  };
}

/**
 * Gorgias HTTP Integration 配置
 */
export interface GorgiasHttpIntegration {
  id: number;
  name: string;
  type: 'http';
  http: {
    id: number;
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    request_content_type: string;
    response_content_type: string;
    triggers: {
      'ticket-created': boolean;
      'ticket-updated': boolean;
      'ticket-message-created': boolean;
      'ticket-self-unsnoozed': boolean;
      'ticket-message-failed': boolean;
      'ticket-handed-over': boolean;
    };
    oauth2: null;
  };
  deactivated_datetime: string | null;
  created_datetime: string;
  updated_datetime: string;
}

export interface GorgiasListResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
  total_count?: number;
}

export interface GorgiasPaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  cursor?: string;
}

/**
 * 构建 Gorgias API URL
 * 包含 SSRF 防护：只允许 *.gorgias.com 域名
 */
function buildUrl(domain: string, path: string): string {
  let baseUrl = domain.trim();
  
  // 确保有协议前缀
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }
  
  // SSRF 防护：验证域名属于 Gorgias
  try {
    const urlObj = new URL(baseUrl);
    const hostname = urlObj.hostname.toLowerCase();
    const isAllowed = hostname === 'gorgias.com' || hostname.endsWith('.gorgias.com');
    if (!isAllowed) {
      throw new Error(`Invalid Gorgias domain: only *.gorgias.com domains are allowed, got: ${hostname}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid Gorgias domain')) {
      throw err;
    }
    throw new Error(`Invalid URL: ${baseUrl}`);
  }
  
  // 确保没有末尾斜杠，然后添加 /api
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl.endsWith('/api')) {
    baseUrl = `${baseUrl}/api`;
  }
  
  return `${baseUrl}${path}`;
}

/**
 * 创建 Basic Auth 头部
 */
function createAuthHeader(email: string, apiKey: string): string {
  return 'Basic ' + Buffer.from(`${email}:${apiKey}`).toString('base64');
}

/**
 * 处理 API 响应
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    
    const error = new Error(`Gorgias API error ${response.status}: ${errorBody || response.statusText}`);
    (error as any).status = response.status;
    (error as any).statusText = response.statusText;
    throw error;
  }
  
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  
  return response.text() as unknown as T;
}

export class GorgiasClient {
  private baseUrl: string;
  private authHeader: string;
  private requestTimeout = 30000; // 30秒超时

  constructor(config: GorgiasConfig) {
    this.baseUrl = buildUrl(config.domain, '');
    this.authHeader = createAuthHeader(config.email, config.apiKey);
    logger.info('GorgiasClient initialized', { domain: config.domain });
  }

  /**
   * 创建带超时的 fetch 请求
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * GET 请求
   */
  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, String(v)));
          } else {
            params.set(key, String(value));
          }
        }
      }
      url += `?${params.toString()}`;
    }

    logger.debug('GET request', { path, query });

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
        },
      });
      return handleResponse<T>(response);
    } catch (err) {
      logger.error('GET request failed', { path, error: err instanceof Error ? err.message : 'Unknown error' });
      throw err;
    }
  }

  /**
   * POST 请求
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    logger.debug('POST request', { path });

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return handleResponse<T>(response);
    } catch (err) {
      logger.error('POST request failed', { path, error: err instanceof Error ? err.message : 'Unknown error' });
      throw err;
    }
  }

  /**
   * PUT 请求
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    logger.debug('PUT request', { path });

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'PUT',
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return handleResponse<T>(response);
    } catch (err) {
      logger.error('PUT request failed', { path, error: err instanceof Error ? err.message : 'Unknown error' });
      throw err;
    }
  }

  /**
   * DELETE 请求
   */
  async delete<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    logger.debug('DELETE request', { path });

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'DELETE',
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
        },
      });
      return handleResponse<T>(response);
    } catch (err) {
      logger.error('DELETE request failed', { path, error: err instanceof Error ? err.message : 'Unknown error' });
      throw err;
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
    created_after?: string;
    created_before?: string;
  }): Promise<GorgiasPaginatedResponse<GorgiasTicket>> {
    return this.get<GorgiasPaginatedResponse<GorgiasTicket>>('/tickets', params);
  }

  /**
   * 获取单个工单
   */
  async getTicket(ticketId: number): Promise<GorgiasTicket> {
    return this.get<GorgiasTicket>(`/tickets/${ticketId}`);
  }

  /**
   * 获取工单消息列表
   */
  async getTicketMessages(ticketId: number, params?: {
    limit?: number;
    cursor?: string;
  }): Promise<GorgiasPaginatedResponse<GorgiasMessage>> {
    return this.get<GorgiasPaginatedResponse<GorgiasMessage>>(`/tickets/${ticketId}/messages`, params);
  }

  /**
   * 获取消息列表
   */
  async getMessages(params?: {
    limit?: number;
    cursor?: string;
    sender_id?: number;
    channel?: string;
  }): Promise<GorgiasPaginatedResponse<GorgiasMessage>> {
    return this.get<GorgiasPaginatedResponse<GorgiasMessage>>('/messages', params);
  }

  /**
   * 获取客户列表
   */
  async getCustomers(params?: {
    limit?: number;
    cursor?: string;
    name?: string;
    email?: string;
  }): Promise<GorgiasPaginatedResponse<GorgiasCustomer>> {
    return this.get<GorgiasPaginatedResponse<GorgiasCustomer>>('/customers', params);
  }

  /**
   * 获取单个客户
   */
  async getCustomer(customerId: number): Promise<GorgiasCustomer> {
    return this.get<GorgiasCustomer>(`/customers/${customerId}`);
  }

  /**
   * 获取坐席用户列表
   */
  async getUsers(params?: {
    limit?: number;
    cursor?: string;
    active?: boolean;
  }): Promise<GorgiasPaginatedResponse<GorgiasUser>> {
    return this.get<GorgiasPaginatedResponse<GorgiasUser>>('/users', params);
  }

  /**
   * 获取标签列表
   */
  async getTags(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<GorgiasPaginatedResponse<GorgiasTag>> {
    return this.get<GorgiasPaginatedResponse<GorgiasTag>>('/tags', params);
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getUsers({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 从 settings 表获取 Gorgias 配置
 */
export async function getGorgiasConfigFromSettings(): Promise<GorgiasConfig | null> {
  // 动态导入避免循环依赖
  const { getSupabaseClient, isDemoMode } = await import('@/storage/database/supabase-client');
  
  if (isDemoMode()) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data: settings, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['gorgias_enabled', 'gorgias_domain', 'gorgias_email', 'gorgias_api_key']);

  if (error || !settings) {
    return null;
  }

  const settingsMap = new Map(settings.map(s => [s.key, s.value]));

  const enabled = settingsMap.get('gorgias_enabled') === 'true';
  const domain = settingsMap.get('gorgias_domain') || '';
  const email = settingsMap.get('gorgias_email') || '';
  const apiKey = settingsMap.get('gorgias_api_key') || '';

  if (!enabled || !domain || !email || !apiKey) {
    return null;
  }

  return { domain, email, apiKey };
}

/**
 * 创建 Gorgias 客户端实例
 */
export async function createGorgiasClient(): Promise<GorgiasClient | null> {
  const config = await getGorgiasConfigFromSettings();
  
  if (!config) {
    logger.debug('Gorgias not configured or disabled');
    return null;
  }

  return new GorgiasClient(config);
}
