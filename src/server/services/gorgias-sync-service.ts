/**
 * Gorgias 同步服务
 * 
 * 处理从 Gorgias Webhook 接收的事件，将数据同步到 SmartAssist
 */

import { getLogger } from '@/lib/logger';
import { 
  GorgiasClient, 
  GorgiasConfig,
  type GorgiasWebhookEvent, 
  type GorgiasTicket, 
  type GorgiasMessage
} from '@/lib/gorgias-client';
import { GorgiasRepository } from '@/server/repositories/gorgias-repository';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { CustomerRepository } from '@/server/repositories/customer-repository';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RetrievalOrchestrator } from '@/server/services/retrieval-orchestrator';

// 静态初始化 supabase 客户端
const supabase = getSupabaseClient();

const logger = getLogger('GorgiasSyncService');

export interface SyncResult {
  success: boolean;
  action?: string;
  created?: number;
  updated?: number;
  errors?: string[];
  conversation_id?: string;
  message_id?: string;
  details?: string;
  synced?: number;
  failed?: number;
}

/**
 * 映射 Gorgias 工单状态到 SmartAssist 对话状态
 */
function mapTicketStatus(status: GorgiasTicket['status']): string {
  switch (status) {
    case 'open':
    case 'pending':
      return 'active';
    case 'solved':
    case 'closed':
      return 'completed';
    case 'spam':
    case 'trashed':
      return 'ended';
    default:
      return 'active';
  }
}

/**
 * 映射 Gorgias 渠道到 SmartAssist 来源
 */
function mapChannel(channel: string): string {
  switch (channel) {
    case 'email':
      return 'gorgias_email';
    case 'chat':
    case 'widget':
      return 'gorgias_chat';
    case 'phone':
      return 'gorgias_phone';
    default:
      return 'gorgias';
  }
}

/**
 * 转换 Gorgias 消息到 SmartAssist 消息格式
 */
function transformMessage(msg: GorgiasMessage) {
  // 判断是用户消息还是坐席消息（author 可能为 undefined，需要安全访问）
  const authorType = msg.author?.type;
  const isFromAgent = authorType === 'user' || authorType === 'channel';

  // 优先使用 Gorgias 的时间戳，无效时 fallback 到服务器时间
  let messageTime: Date;
  try {
    if (msg.created_datetime) {
      messageTime = new Date(msg.created_datetime);
      if (isNaN(messageTime.getTime())) {
        messageTime = new Date();
      }
    } else {
      messageTime = new Date();
    }
  } catch {
    messageTime = new Date();
  }

  return {
    role: isFromAgent ? 'assistant' as const : 'user' as const,
    content: msg.plain_body || msg.body_text || '',
    message_type: 'text' as const,
    created_at: messageTime,
    metadata: {
      gorgias_message_id: String(msg.id),
      channel: msg.channel,
      subject: msg.subject,
      author: {
        id: msg.author?.id,
        type: authorType || 'customer',
        name: msg.author?.name,
        email: msg.author?.email,
      },
      gorgias_created_at: msg.created_datetime,
    },
  };
}

// ============================================
// Webhook 事件幂等性检查函数（持久化存储）
// ============================================

/**
 * 检查 Webhook 事件是否已处理过
 * 使用数据库持久化存储，支持多实例部署
 */
/**
 * 原子幂等检查：尝试插入幂等记录，利用数据库 UNIQUE 约束防止并发竞态。
 * 返回 true 表示获得处理权（首次），false 表示已被处理。
 */
export async function tryAcquireWebhookEvent(
  eventId: string,
  eventType: string = 'unknown',
  objectId?: string
): Promise<boolean> {
  if (isDemoMode()) {
    return true;
  }

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('webhook_event_processed')
      .insert({
        event_id: eventId,
        event_type: eventType,
        object_id: objectId || null,
        result: 'success',
      });

    if (error) {
      // 23505 = unique_violation: another request already inserted this event
      if (error.code === '23505') {
        return false;
      }
      // Other errors: log but allow processing (conservative)
      logger.error('Failed to acquire webhook event lock', {
        context: { eventId, error: error.message }
      });
      return true;
    }

    return true;
  } catch (error) {
    logger.error('tryAcquireWebhookEvent exception', {
      context: { eventId, error: error instanceof Error ? error.message : 'Unknown' }
    });
    return true;
  }
}

export async function checkWebhookEventProcessed(eventId: string): Promise<boolean> {
  if (isDemoMode()) {
    // Demo 模式下跳过检查
    return false;
  }

  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('webhook_event_processed')
      .select('id')
      .eq('event_id', eventId)
      .single();

    return !!data;
  } catch (error) {
    // 查询出错时默认视为未处理（保守策略）
    logger.error('Failed to check webhook event processed status', {
      context: { eventId, error: error instanceof Error ? error.message : 'Unknown' }
    });
    return false;
  }
}

/**
 * 标记 Webhook 事件已处理
 * 使用 upsert 确保幂等性
 */
export async function markWebhookEventProcessed(
  eventId: string,
  eventType: string = 'unknown',
  objectId?: string,
  result: 'success' | 'failed' = 'success',
  errorMessage?: string
): Promise<void> {
  if (isDemoMode()) {
    // Demo 模式下跳过
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('webhook_event_processed')
      .upsert({
        event_id: eventId,
        event_type: eventType,
        object_id: objectId || null,
        result,
        error_message: errorMessage || null,
        processed_at: new Date().toISOString(),
      }, {
        onConflict: 'event_id'
      });

    if (error) {
      logger.error('Failed to mark webhook event as processed', {
        context: { eventId, error: error.message }
      });
    }
  } catch (error) {
    logger.error('Failed to mark webhook event processed', {
      context: { eventId, error: error instanceof Error ? error.message : 'Unknown' }
    });
  }
}

/**
 * 清理过期的 Webhook 事件记录（保留 30 天）
 * 可定期调用以清理历史数据
 */
export async function cleanupExpiredWebhookEvents(): Promise<number> {
  if (isDemoMode()) {
    return 0;
  }

  try {
    const supabase = getSupabaseClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count, error } = await supabase
      .from('webhook_event_processed')
      .delete()
      .lt('processed_at', thirtyDaysAgo.toISOString());

    if (error) {
      logger.error('Failed to cleanup expired webhook events', {
        context: { error: error.message }
      });
      return 0;
    }

    return count || 0;
  } catch (error) {
    logger.error('Failed to cleanup expired webhook events', {
      context: { error: error instanceof Error ? error.message : 'Unknown' }
    });
    return 0;
  }
}

/**
 * Gorgias 同步服务
 */
export class GorgiasSyncService {
  /**
   * 获取 Gorgias 配置
   */
  async getSettings(): Promise<GorgiasConfig | null> {
    // 获取所有 gorgias_ 开头的设置
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value');
    
    if (!settings) return null;
    
    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      if (s.key.startsWith('gorgias_')) {
        settingsMap[s.key] = s.value;
      }
    }
    
    const domain = settingsMap['gorgias_domain'];
    const email = settingsMap['gorgias_email'];
    const apiKey = settingsMap['gorgias_api_key'];
    
    if (!domain || !email || !apiKey) {
      return null;
    }
    
    return { domain, email, apiKey } as const;
  }

  /**
   * 安全提取 Webhook 事件中的工单数据
   * 如果 webhook body 中没有 ticket 数据，尝试从 Gorgias API 拉取
   */
  private async extractTicket(event: GorgiasWebhookEvent): Promise<GorgiasTicket | null> {
    // 如果 webhook body 中包含完整 ticket 数据，直接返回
    if (event.data?.ticket) {
      return event.data.ticket;
    }

    // 否则尝试从 Gorgias API 拉取
    const ticketId = event.object_id;
    if (!ticketId) {
      logger.warn('GorgiasSync: Webhook event missing both ticket data and object_id', {
        context: { eventId: event.id, type: event.type }
      });
      return null;
    }

    logger.info('GorgiasSync: Fetching ticket from API', {
      context: { ticketId, eventId: event.id, type: event.type }
    });

    const ticket = await this.fetchTicketFromApi(ticketId);
    if (!ticket) {
      logger.warn('GorgiasSync: Failed to fetch ticket from API', {
        context: { ticketId, eventId: event.id }
      });
      return null;
    }

    return ticket;
  }

  /**
   * 从 Gorgias API 拉取工单详情（含消息）
   */
  private async fetchTicketFromApi(ticketId: number): Promise<GorgiasTicket | null> {
    const settings = await this.getSettings();
    if (!settings) {
      logger.error('GorgiasSync: Cannot fetch ticket - Gorgias not configured');
      return null;
    }

    const client = new GorgiasClient({
      domain: settings.domain,
      email: settings.email,
      apiKey: settings.apiKey,
    });

    try {
      // 获取工单详情
      const ticket = await client.getTicket(ticketId);
      if (!ticket) {
        logger.warn('GorgiasSync: Ticket not found in Gorgias', { context: { ticketId } });
        return null;
      }

      // 获取工单消息列表
      const messagesResponse = await client.getTicketMessages(ticketId, { limit: 100 });
      if (messagesResponse?.data && Array.isArray(messagesResponse.data)) {
        ticket.messages = messagesResponse.data;
      }

      logger.info('GorgiasSync: Successfully fetched ticket from API', {
        context: { ticketId, messageCount: ticket.messages?.length || 0 }
      });

      return ticket;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('GorgiasSync: Failed to fetch ticket from API', {
        context: { ticketId, error: message }
      });
      return null;
    }
  }

  /**
   * 处理新工单创建事件
   */
  async handleTicketCreated(event: GorgiasWebhookEvent): Promise<SyncResult> {
    const ticket = await this.extractTicket(event);
    if (!ticket) {
      return { success: false, created: 0, updated: 0, errors: ['Missing ticket data in event'] };
    }
    
    logger.info('GorgiasSync: Processing ticket-created', {
      context: { ticketId: ticket.id, subject: ticket.subject }
    });
    
    try {
      // 查找是否已存在该工单对应的对话
      const existingConversation = await this.findConversationByGorgiasTicketId(ticket.id);
      
      if (existingConversation) {
        logger.debug('GorgiasSync: Ticket already exists, updating', {
          context: { ticketId: ticket.id, conversationId: existingConversation }
        });
        // 即使对话已存在，也尝试同步可能遗漏的消息
        if (ticket.messages && Array.isArray(ticket.messages) && ticket.messages.length > 0) {
          await this.syncMessages(existingConversation, ticket.messages, ticket.id);
        }
        return {
          success: true,
          action: 'updated',
          conversation_id: existingConversation,
          details: 'Conversation already exists'
        };
      }
      
      // 如果工单没有消息，暂不创建空对话，等消息到达时再创建
      const hasMessages = ticket.messages && Array.isArray(ticket.messages) && ticket.messages.length > 0;
      if (!hasMessages) {
        logger.info('GorgiasSync: Ticket has no messages, deferring conversation creation', {
          context: { ticketId: ticket.id }
        });
        return {
          success: true,
          action: 'deferred_no_messages',
          details: 'Ticket has no messages, waiting for ticket-message-created event'
        };
      }
      
      // 创建新对话
      const conversationId = await this.createConversationFromTicket(ticket, event);
      
      // 同步消息（hasMessages 已确保 ticket.messages 存在且非空）
      const messages = ticket.messages!;
      await this.syncMessages(conversationId, messages, ticket.id);
        
      // ticket-created 不触发 AI 回复：
      // Gorgias 通常会紧跟发送 ticket-message-created 事件，由该事件触发 AI 回复。
      // 如果在此处也触发，会导致同一用户消息产生重复 AI 回复。
      // 仅当确实没有后续 message-created 事件时（极端情况），用户需手动在监控页操作。
      
      return {
        success: true,
        action: 'created',
        conversation_id: conversationId,
        details: `Created conversation for ticket #${ticket.id}`
      };
      
    } catch (error) {
      logger.error('GorgiasSync: Failed to process ticket-created', {
        context: { 
          ticketId: ticket.id, 
          error: error instanceof Error ? error.message : String(error) 
        }
      });
      throw error;
    }
  }
  
  /**
   * 处理新消息到达事件
   */
  async handleTicketMessageCreated(event: GorgiasWebhookEvent): Promise<SyncResult> {
    const ticket = await this.extractTicket(event);
    if (!ticket) {
      return { success: false, created: 0, updated: 0, errors: ['Missing ticket data in event'] };
    }
    
    logger.info('GorgiasSync: Processing ticket-message-created', {
      context: { ticketId: ticket.id, messageCount: ticket.messages?.length || 0 }
    });
    
    try {
      // 如果工单没有消息，不创建空对话
      const hasMessages = ticket.messages && Array.isArray(ticket.messages) && ticket.messages.length > 0;
      
      // 查找已有对话
      let conversationId = await this.findConversationByGorgiasTicketId(ticket.id);
      
      if (!conversationId) {
        if (!hasMessages) {
          // 工单无消息且没有已有对话，暂不创建空对话，等待后续消息事件
          logger.info('GorgiasSync: No messages and no existing conversation, skipping', {
            context: { ticketId: ticket.id }
          });
          return { success: true, action: 'skipped_no_messages' };
        }
        logger.info('GorgiasSync: Creating conversation for incoming message', {
          context: { ticketId: ticket.id }
        });
        conversationId = await this.createConversationFromTicket(ticket, event);
      } else {
        // 更新对话状态
        await this.updateConversationStatus(conversationId, ticket);
      }
      
      // 同步消息
      if (hasMessages) {
        // 同步所有未同步的消息（而非仅最后一条，因为 API 可能返回完整消息列表）
        const syncedMessages = await this.syncMessages(conversationId, ticket.messages!, ticket.id);
        
        // 如果有新同步的客户消息，触发 AI 自动回复（fire-and-forget，不阻塞 Webhook 响应）
        const hasNewUserMessage = syncedMessages.some(msg => {
          const isFromAgent = typeof msg.from_agent === 'boolean'
            ? msg.from_agent
            : false;
          return !isFromAgent;
        });
        if (hasNewUserMessage) {
          this.triggerAIReply(conversationId).catch(err => {
            logger.error('GorgiasSync: triggerAIReply failed in ticket-message-created', {
              context: { conversationId, error: err instanceof Error ? err.message : String(err) }
            });
          });
        }
        
        return {
          success: true,
          action: 'message_added',
          conversation_id: conversationId,
          details: `Synced ${syncedMessages.length} message(s) for ticket #${ticket.id}`
        };
      }
      
      return {
        success: true,
        action: 'no_message',
        conversation_id: conversationId
      };
      
    } catch (error) {
      logger.error('GorgiasSync: Failed to process ticket-message-created', {
        context: { 
          ticketId: ticket.id, 
          error: error instanceof Error ? error.message : String(error) 
        }
      });
      throw error;
    }
  }
  
  /**
   * 处理工单状态变更事件
   */
  async handleTicketUpdated(event: GorgiasWebhookEvent): Promise<SyncResult> {
    const ticket = await this.extractTicket(event);
    if (!ticket) {
      return { success: false, created: 0, updated: 0, errors: ['Missing ticket data in event'] };
    }
    
    logger.info('GorgiasSync: Processing ticket-updated', {
      context: { ticketId: ticket.id, status: ticket.status }
    });
    
    try {
      let conversationId = await this.findConversationByGorgiasTicketId(ticket.id);
      
      if (!conversationId) {
        // 工单还没同步，仅在工单有消息时创建对话
        const hasMessages = ticket.messages && Array.isArray(ticket.messages) && ticket.messages.length > 0;
        if (!hasMessages) {
          logger.info('GorgiasSync: Ticket-updated with no messages, deferring conversation creation', {
            context: { ticketId: ticket.id }
          });
          return {
            success: true,
            action: 'deferred_no_messages',
            details: 'Ticket has no messages, waiting for ticket-message-created event'
          };
        }
        conversationId = await this.createConversationFromTicket(ticket, event);
        if (ticket.messages && Array.isArray(ticket.messages)) {
          const newMessages = await this.syncMessages(conversationId, ticket.messages, ticket.id);

          // 只针对本次新同步的客户消息触发 AI 自动回复
          const hasNewUserMessage = newMessages.some(msg => {
            const isFromAgent = typeof msg.from_agent === 'boolean'
              ? msg.from_agent
              : msg.author?.type === 'user' || msg.author?.type === 'channel';
            return !isFromAgent;
          });
          if (hasNewUserMessage) {
            this.triggerAIReply(conversationId).catch(err => {
              logger.error('GorgiasSync: triggerAIReply failed in ticket-updated (new)', {
                context: { conversationId, error: err instanceof Error ? err.message : String(err) }
              });
            });
          }
        }
        return {
          success: true,
          action: 'created',
          conversation_id: conversationId,
          details: ticket.messages?.length ? `Created with ${ticket.messages.length} messages` : 'Created'
        };
      }

      // 更新对话状态
      await this.updateConversationStatus(conversationId, ticket);

      // 同步可能的新消息（ticket-updated 也可能包含新消息）
      if (ticket.messages && Array.isArray(ticket.messages)) {
        const newMessages = await this.syncMessages(conversationId, ticket.messages, ticket.id);

        // 只针对本次新同步的客户消息触发 AI 自动回复，避免已有历史消息导致重复回复
        const hasNewUserMessage = newMessages.some(msg => {
          const isFromAgent = typeof msg.from_agent === 'boolean'
            ? msg.from_agent
            : msg.author?.type === 'user' || msg.author?.type === 'channel';
          return !isFromAgent;
        });
        if (hasNewUserMessage) {
          this.triggerAIReply(conversationId).catch(err => {
            logger.error('GorgiasSync: triggerAIReply failed in ticket-updated', {
              context: { conversationId, error: err instanceof Error ? err.message : String(err) }
            });
          });
        }
      }
      
      return {
        success: true,
        action: 'updated',
        conversation_id: conversationId,
        details: `Updated status to ${ticket.status}`
      };
      
    } catch (error) {
      logger.error('GorgiasSync: Failed to process ticket-updated', {
        context: { 
          ticketId: ticket.id, 
          error: error instanceof Error ? error.message : String(error) 
        }
      });
      throw error;
    }
  }
  
  /**
   * 处理转人工事件
   */
  async handleTicketHandedOver(event: GorgiasWebhookEvent): Promise<SyncResult> {
    const ticket = await this.extractTicket(event);
    if (!ticket) {
      return { success: false, created: 0, updated: 0, errors: ['Missing ticket data in event'] };
    }
    
    logger.info('GorgiasSync: Processing ticket-handed-over', {
      context: { ticketId: ticket.id, assignee: ticket.assignee_user }
    });
    
    try {
      const conversationId = await this.findConversationByGorgiasTicketId(ticket.id);
      
      if (!conversationId) {
        // 创建对话并标记为转人工
        const newId = await this.createConversationFromTicket(ticket, event, true);
        // 同步消息（createConversationFromTicket 不再内部同步）
        if (ticket.messages && Array.isArray(ticket.messages)) {
          await this.syncMessages(newId, ticket.messages, ticket.id);
        }
        return {
          success: true,
          action: 'created_as_handoff',
          conversation_id: newId
        };
      }
      
      // 更新为转人工状态
      await this.updateConversationToHandoff(conversationId, ticket);
      
      // 创建转人工告警
      await this.createHandoffAlert(conversationId, ticket);
      
      return {
        success: true,
        action: 'handoff',
        conversation_id: conversationId,
        details: 'Conversation marked as handoff'
      };
      
    } catch (error) {
      logger.error('GorgiasSync: Failed to process ticket-handed-over', {
        context: { 
          ticketId: ticket.id, 
          error: error instanceof Error ? error.message : String(error) 
        }
      });
      throw error;
    }
  }

  /**
   * 处理 Webhook 事件
   */
  async processWebhookEvent(event: GorgiasWebhookEvent): Promise<{ success: boolean; details?: string }> {
    const { id, type, object_id, object_type } = event;
    
    logger.info(`Processing webhook event: ${type}`, { eventId: id, objectId: object_id, objectType: object_type });

    try {
      switch (type) {
        case 'ticket-created':
          await this.handleTicketCreated(event);
          break;
        case 'ticket-message-created':
          await this.handleTicketMessageCreated(event);
          break;
        case 'ticket-updated':
          await this.handleTicketUpdated(event);
          break;
        case 'ticket-handed-over':
          await this.handleTicketHandedOver(event);
          break;
        default:
          logger.info(`Unhandled event type: ${type}`);
      }
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Webhook event processing failed', { eventId: id, error: message });
      return { success: false, details: message };
    }
  }

  /**
   * 同步单个工单（用于全量同步）
   */
  async syncTicket(ticketId: number): Promise<SyncResult> {
    const settings = await this.getSettings();
    if (!settings) {
      return {
        success: false,
        action: 'error',
        details: 'Gorgias integration is not configured'
      };
    }

    const client = new GorgiasClient({
      domain: settings.domain,
      email: settings.email,
      apiKey: settings.apiKey,
    });

    try {
      // 从 Gorgias 获取工单详情
      const ticket = await client.getTicket(ticketId);
      
      if (!ticket) {
        return {
          success: false,
          action: 'error',
          details: `Ticket ${ticketId} not found in Gorgias`
        };
      }

      // 查找是否已存在该工单对应的对话
      const existingConversation = await this.findConversationByGorgiasTicketId(ticketId);
      
      if (existingConversation) {
        // 更新现有对话
        await this.updateConversationStatus(existingConversation, ticket);
        
        // 同步消息
        if (ticket.messages && Array.isArray(ticket.messages)) {
          await this.syncMessages(existingConversation, ticket.messages, ticketId);
        }
        
        return {
          success: true,
          action: 'updated',
          conversation_id: existingConversation,
          details: 'Conversation updated'
        };
      } else {
        // 创建新对话
        const conversationId = await this.createConversationFromTicket(ticket, {} as GorgiasWebhookEvent);
        
        // 同步消息（createConversationFromTicket 不再内部同步）
        if (ticket.messages && Array.isArray(ticket.messages)) {
          await this.syncMessages(conversationId, ticket.messages, ticketId);
        }
        
        return {
          success: true,
          action: 'created',
          conversation_id: conversationId,
          details: `Created conversation for ticket #${ticketId}`
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        action: 'error',
        details: message
      };
    }
  }

  /**
   * 全量同步所有工单
   */
  async syncAllTickets(since?: Date): Promise<SyncResult> {
    const settings = await this.getSettings();
    if (!settings) {
      return {
        success: false,
        action: 'error',
        details: 'Gorgias integration is not configured'
      };
    }

    const client = new GorgiasClient({
      domain: settings.domain,
      email: settings.email,
      apiKey: settings.apiKey,
    });

    const errors: string[] = [];
    let synced = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;

    try {
      while (hasMore) {
        // 获取当前页工单
        const result = await client.getTickets({
          limit: 100,
          cursor,
          ...(since && { created_after: since.toISOString() })
        });

        for (const ticket of result.data) {
          const res = await this.syncTicket(ticket.id);
          if (res.success) {
            synced++;
          } else {
            failed++;
            if (res.details) {
              errors.push(`Ticket ${ticket.id}: ${res.details}`);
            }
          }
        }

        // 检查是否有更多页
        hasMore = result.has_more;
        cursor = result.cursor;

        logger.debug('GorgiasSync: Synced page', { cursor, synced, failed });
      }

      return { success: true, synced, failed, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, synced, failed, errors: [message] };
    }
  }

  // ==================== 私有方法 ====================
  
  /**
   * 根据 Gorgias 工单 ID 查找 SmartAssist 对话
   */
  private async findConversationByGorgiasTicketId(ticketId: number): Promise<string | null> {
    const conversationRepo = new ConversationRepository();
    const conversation = await conversationRepo.findByGorgiasTicketId(ticketId);
    return conversation?.id ?? null;
  }
  
  /**
   * 检查单条 Gorgias 消息是否已存在
   */
  private async checkMessageExists(messageId: number): Promise<boolean> {
    const conversationRepo = new ConversationRepository();
    const message = await conversationRepo.findByGorgiasMessageId(messageId);
    return message !== null;
  }
  
  /**
   * 批量检查多条 Gorgias 消息是否已存在（P1-5 N+1 查询优化）
   */
  private async checkMessagesExist(messageIds: number[]): Promise<Set<number>> {
    if (messageIds.length === 0) {
      return new Set();
    }

    // 转换为字符串以便 IN 查询
    const messageIdStrings = messageIds.map(id => String(id));

    const { data, error } = await supabase
      .from('messages')
      .select('metadata->>gorgias_message_id')
      .in('metadata->>gorgias_message_id', messageIdStrings);

    if (error) {
      logger.error('Failed to batch check messages existence', {
        context: { error: error.message }
      });
      // 出错时返回空集合（保守策略：视为都未存在）
      return new Set();
    }

    // 返回已存在的消息 ID 集合
    const existingIds = new Set<number>();
    for (const item of data || []) {
      // item 是包含 gorgias_message_id 字符串值的记录
      const gorgiasMsgId = (item as { gorgias_message_id?: string }).gorgias_message_id;
      if (gorgiasMsgId) {
        existingIds.add(parseInt(gorgiasMsgId, 10));
      }
    }
    return existingIds;
  }
  
  /**
   * 从工单创建对话
   */
  private async createConversationFromTicket(
    ticket: GorgiasTicket, 
    event: GorgiasWebhookEvent,
    isHandoff: boolean = false
  ): Promise<string> {
    const supabase = getSupabaseClient();
    
    // 创建或匹配客户
    const customerId = await this.findOrCreateCustomer(ticket);
    
    // 构建元数据（gorgias_ticket_id 强制转为 string，确保 JSONB 中存储为文本类型，
    // 避免 number 大数被转为科学计数法导致唯一索引失效）
    const metadata = {
      gorgias_ticket_id: String(ticket.id),
      gorgias_status: ticket.status,
      gorgias_channel: ticket.channel,
      gorgias_tags: ticket.tags?.map((t: { name: string }) => t.name) || [],
      gorgias_created_at: ticket.created_datetime,
      gorgias_assignee: ticket.assignee_user,
    };
    
    // 创建对话（处理并发竞态：唯一索引可能因同时创建而冲突）
    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert({
        title: ticket.subject || `Gorgias 工单 #${ticket.id}`,
        status: isHandoff ? 'handoff' : mapTicketStatus(ticket.status),
        source: mapChannel(ticket.channel),
        priority: ticket.priority === 'urgent' || ticket.priority === 'high' ? 'urgent' : 'normal',
        metadata,
        external_user_id: ticket.customer?.email || String(ticket.customer?.id),
      })
      .select('id')
      .single();
    
    if (error || !conversation) {
      // Concurrent race condition: another request already created a conversation for this ticket.
      // Unique index on metadata->>'gorgias_ticket_id' prevents duplicate inserts.
      // Fall back to finding the existing conversation.
      if (error?.code === '23505') {
        logger.info('GorgiasSync: Duplicate conversation detected (race condition), finding existing', {
          context: { ticketId: ticket.id }
        });
        const existingId = await this.findConversationByGorgiasTicketId(ticket.id);
        if (existingId) {
          return existingId;
        }
      }
      throw new Error(`Failed to create conversation: ${error?.message}`);
    }
    
    logger.info('GorgiasSync: Created conversation', {
      context: { conversationId: conversation.id, ticketId: ticket.id }
    });
    
    // 消息同步由调用者负责（handleTicketCreated/handleTicketUpdated 等）
    // 不在此处重复同步，避免 handleTicketCreated 外部再次调用时造成双重同步
    
    return conversation.id;
  }
  
  // Per-ticket 处理锁，防止同一工单的并发 Webhook 事件同时处理
  private static processingTickets = new Map<number, Promise<GorgiasMessage[]>>();

  // Per-conversation AI 回复去重：记录最近一次 AI 回复的时间，防止多事件重复触发
  private static lastAIReplyTime = new Map<string, number>();
  private static AI_REPLY_DEDUP_WINDOW_MS = 30_000; // 30秒内不重复触发

  /**
   * 同步多条消息（逐条插入 + 竞态保护）
   * 
   * 防止并发 Webhook 事件的 TOCTOU 竞态：
   * 1. 批量检查消息是否存在
   * 2. 逐条插入，插入后立即验证（checkMessageExists）
   * 3. 如果插入后发现重复（并发导致），删除多余记录
   */
  private async syncMessages(
    conversationId: string,
    messages: GorgiasMessage[],
    ticketId: number
  ): Promise<GorgiasMessage[]> {
    if (!messages || messages.length === 0) {
      return [];
    }

    const supabase = getSupabaseClient();

    // 使用 per-ticket 互斥锁，确保同一工单不会并发处理
    const lockKey = ticketId;
    const previousPromise = GorgiasSyncService.processingTickets.get(lockKey);
    let resolveLock: () => void;
    const currentPromise = new Promise<GorgiasMessage[]>(resolve => { resolveLock = () => resolve([]); });
    GorgiasSyncService.processingTickets.set(lockKey, currentPromise);

    // 等待前一个同工单的处理完成
    if (previousPromise) {
      await previousPromise;
    }

    try {
      // 批量检查消息是否已存在
      const messageIds = messages.map(msg => msg.id);
      const existingMessageIds = await this.checkMessagesExist(messageIds);

      // 过滤出还没有同步的消息
      const newMessages = messages.filter(msg => !existingMessageIds.has(msg.id));

      if (newMessages.length === 0) {
        return [];
      }

      // 逐条插入消息，避免批量 insert 导致的 TOCTOU 竞态
      const actuallySynced: GorgiasMessage[] = [];
      for (const msg of newMessages) {
        const transformed = transformMessage(msg);
        const insertPayload = {
          ...transformed,
          conversation_id: conversationId,
          created_at: transformed.created_at || new Date(),
        };

        const { error } = await supabase
          .from('messages')
          .insert(insertPayload);

        if (error) {
          // 检查是否是唯一约束冲突（并发插入导致）
          if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
            logger.info('GorgiasSync: Message already inserted by concurrent request, skipping', {
              context: { messageId: msg.id, ticketId }
            });
            continue;
          }
          logger.error('GorgiasSync: Failed to insert message', {
            context: { messageId: msg.id, ticketId, error: error.message }
          });
          continue;
        }

        // 插入后二次验证：检查是否有并发插入导致同一条 gorgias_message_id 出现多次
        const { data: duplicates } = await supabase
          .from('messages')
          .select('id')
          .eq('metadata->>gorgias_message_id', String(msg.id))
          .eq('conversation_id', conversationId);

        if (duplicates && duplicates.length > 1) {
          // 保留第一条（created_at 最早的），删除其余重复
          const toDelete = duplicates.slice(1).map(d => d.id);
          logger.warn('GorgiasSync: Found duplicate messages after insert, cleaning up', {
            context: { messageId: msg.id, duplicateCount: duplicates.length, deletingCount: toDelete.length }
          });
          await supabase.from('messages').delete().in('id', toDelete);
        }

        actuallySynced.push(msg);
      }

      // Update conversation message_count by the actual number of new messages inserted
      try {
        if (actuallySynced.length > 0) {
          await supabase.rpc('increment_message_count_by', { conv_id: conversationId, delta: actuallySynced.length });
        }
        // Update conversation's updated_at so it appears at the top of the list
        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId);
      } catch {
        // Fallback: try the original +1 RPC if the new one doesn't exist yet
        try {
          for (let i = 0; i < actuallySynced.length; i++) {
            await supabase.rpc('increment_message_count', { conv_id: conversationId });
          }
          await supabase
            .from('conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId);
        } catch {
          // Both RPCs may not exist, silently ignore
        }
      }

      return actuallySynced;
    } finally {
      // 释放锁
      resolveLock!();
      // 清理 Map（仅当当前 promise 仍是该 key 对应的值时）
      if (GorgiasSyncService.processingTickets.get(lockKey) === currentPromise) {
        GorgiasSyncService.processingTickets.delete(lockKey);
      }
    }
  }
  
  /**
   * 同步单条消息（含竞态保护）
   */
  private async syncSingleMessage(
    conversationId: string,
    message: GorgiasMessage,
    ticketId: number
  ): Promise<{ message_id: string; role: string; is_new: boolean }> {
    // 检查是否已存在
    const exists = await this.checkMessageExists(message.id);
    
    if (exists) {
      return { message_id: String(message.id), role: 'existing', is_new: false };
    }
    
    const supabase = getSupabaseClient();
    
    const transformed = transformMessage(message);
    
    const { data, error } = await supabase
      .from('messages')
      .insert({
        ...transformed,
        conversation_id: conversationId,
        created_at: transformed.created_at || new Date(),
      })
      .select('id')
      .single();
    
    if (error) {
      // 唯一约束冲突 = 并发插入，视为已存在
      if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
        logger.info('GorgiasSync: Message already inserted by concurrent request', {
          context: { messageId: message.id }
        });
        return { message_id: String(message.id), role: 'existing', is_new: false };
      }
      logger.error('GorgiasSync: Failed to sync message', {
        context: { messageId: message.id, error: error.message }
      });
      throw error;
    }
    
    // 更新对话消息数
    try {
      await supabase.rpc('increment_message_count', { conv_id: conversationId });
    } catch {
      // RPC 可能不存在，静默忽略
    }
    
    return {
      message_id: data.id,
      role: transformed.role,
      is_new: true
    };
  }
  
  /**
   * 检查消息是否已存在
   */
  private async checkMessageExistsByGorgiasId(messageId: number): Promise<boolean> {
    const supabase = getSupabaseClient();
    
    const { data } = await supabase
      .from('messages')
      .select('id')
      .eq('metadata->>gorgias_message_id', String(messageId))
      .single();
    
    return !!data;
  }
  
  /**
   * 更新对话状态
   */
  private async updateConversationStatus(conversationId: string, ticket: GorgiasTicket): Promise<void> {
    const supabase = getSupabaseClient();

    // 只在状态实际变化时才更新，避免无条件刷新 updated_at
    const newStatus = mapTicketStatus(ticket.status);
    const { data: current } = await supabase
      .from('conversations')
      .select('status, metadata')
      .eq('id', conversationId)
      .single();

    // 合并 metadata，保留原有字段（gorgias_ticket_id, gorgias_channel, gorgias_created_at 等）
    const existingMetadata = (current?.metadata as Record<string, unknown>) || {};
    const updateFields: Record<string, unknown> = {
      metadata: {
        ...existingMetadata,
        gorgias_status: ticket.status,
        gorgias_assignee: ticket.assignee_user,
        gorgias_tags: ticket.tags?.map((t: { name: string }) => t.name) || [],
      },
    };

    if (current?.status !== newStatus) {
      updateFields.status = newStatus;
      updateFields.updated_at = new Date().toISOString();
    }

    await supabase
      .from('conversations')
      .update(updateFields)
      .eq('id', conversationId);
  }
  
  /**
   * 更新对话为转人工状态
   */
  private async updateConversationToHandoff(conversationId: string, ticket: GorgiasTicket): Promise<void> {
    const supabase = getSupabaseClient();

    // 先读取当前 metadata 以合并更新
    const { data: current } = await supabase
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .single();

    const existingMetadata = (current?.metadata as Record<string, unknown>) || {};

    await supabase
      .from('conversations')
      .update({
        status: 'handoff',
        metadata: {
          ...existingMetadata,
          gorgias_ticket_id: ticket.id,
          gorgias_status: ticket.status,
          gorgias_channel: ticket.channel,
          gorgias_tags: ticket.tags?.map((t: { name: string }) => t.name) || [],
          gorgias_assignee: ticket.assignee_user,
          gorgias_handed_over_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  }
  
  /**
   * 查找或创建客户
   */
  private async findOrCreateCustomer(ticket: GorgiasTicket): Promise<string | null> {
    if (!ticket.customer?.email) {
      return null;
    }
    
    const supabase = getSupabaseClient();
    
    // 查找已有客户
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('email', ticket.customer.email)
      .single();
    
    if (existing) {
      return existing.id;
    }
    
    // 创建新客户
    const { data: customer, error } = await supabase
      .from('customers')
      .insert({
        email: ticket.customer.email,
        name: ticket.customer.name || ticket.customer.firstname || ticket.customer.email,
        source_platform: 'gorgias',
        external_id: String(ticket.customer.id),
        metadata: {
          gorgias_customer_id: ticket.customer.id,
        },
      })
      .select('id')
      .single();
    
    if (error) {
      logger.warn('GorgiasSync: Failed to create customer', {
        context: { email: ticket.customer.email, error: error.message }
      });
      return null;
    }
    
    return customer?.id || null;
  }
  
  /**
   * 创建转人工告警
   */
  private async createHandoffAlert(conversationId: string, ticket: GorgiasTicket): Promise<void> {
    const supabase = getSupabaseClient();
    
    await supabase
      .from('alerts')
      .insert({
        type: 'gorgias_handoff',
        severity: 'info',
        message: `Gorgias 工单 #${ticket.id} 已转人工处理`,
        conversation_id: conversationId,
        metadata: {
          ticket_id: ticket.id,
          status: ticket.status,
          channel: ticket.channel,
        },
      });
  }

  /**
   * 触发 AI 回复（可选功能）
   *
   * 当收到客户消息时，可以触发 SmartAssist AI 自动回复
   * 目前是 fire-and-forget 实现
   *
   * P1 FIX: 使用 RetrievalOrchestrator 替代直接调用 KnowledgeSearchService。
   * 这确保三条路径（模拟/正式对话/Gorgias）共享同一套查询门控和引用契约，
   * 不会将未分级的候选引用自动附加为引用。
   */
  private async triggerAIReply(conversationId: string): Promise<void> {
    // 去重检查：如果同一对话在去重窗口内已经触发过 AI 回复，跳过
    // 这防止了 ticket-created + ticket-message-created + ticket-updated 三个事件
    // 几乎同时到达时对同一个用户消息生成 3 条不同的 AI 回复
    const now = Date.now();
    const lastReplyTime = GorgiasSyncService.lastAIReplyTime.get(conversationId) || 0;
    if (now - lastReplyTime < GorgiasSyncService.AI_REPLY_DEDUP_WINDOW_MS) {
      logger.info('GorgiasSync: Skipping duplicate AI reply trigger (within dedup window)', {
        context: { conversationId, elapsedMs: now - lastReplyTime }
      });
      return;
    }
    // 乐观标记触发时间，防止并发请求同时通过
    GorgiasSyncService.lastAIReplyTime.set(conversationId, now);

    // 二次检查：如果对话中最后一条消息已经是 assistant 消息，不再重复回复
    // 这处理了去重窗口过期后、但 AI 已经回复过的场景
    try {
      const { ConversationRepository } = await import('@/server/repositories/conversation-repository');
      const convRepo = new ConversationRepository();
      const messages = await convRepo.listMessages(conversationId, 1);
      if (messages && messages.length > 0 && messages[0].role === 'assistant') {
        logger.info('GorgiasSync: Last message is already from assistant, skipping AI reply', {
          context: { conversationId }
        });
        return;
      }
    } catch {
      // 检查失败不阻止流程
    }

    const { ConversationService } = await import('@/server/services/conversation-service');
    const { AutoReplyService } = await import('@/server/services/auto-reply-service');
    const { LLMStreamingService } = await import('@/server/services/llm-streaming-service');
    const { SettingsService } = await import('@/server/services/settings-service');
    const { ConversationRepository } = await import('@/server/repositories/conversation-repository');

    try {
      logger.info('GorgiasSync: Triggering AI reply', { context: { conversationId } });

      // 1. Validate conversation can receive AI messages
      const conversationService = new ConversationService();
      try {
        await conversationService.ensureCanReceiveAiMessage(conversationId);
      } catch {
        logger.warn('GorgiasSync: Conversation cannot receive AI reply', { context: { conversationId } });
        return;
      }

      // 2. Get the last user message
      const convRepo = new ConversationRepository();
      const messages = await convRepo.listMessages(conversationId, 5);
      const lastUserMsg = [...(messages || [])].reverse().find((m: { role: string }) => m.role === 'user');
      if (!lastUserMsg) {
        logger.warn('GorgiasSync: No user message found to reply to', { context: { conversationId } });
        return;
      }

      const userMessage = (lastUserMsg as { content: string }).content;

      // 3. Check auto-reply rules FIRST (short-circuit before expensive retrieval)
      const autoReplyService = new AutoReplyService();
      const autoReply = await autoReplyService.matchReply(userMessage);
      if (autoReply) {
        await conversationService.insertMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: autoReply.content,
          confidence: 1.0,
          sources: [{ type: 'auto_reply', keyword: autoReply.rule.keyword }],
        });
        logger.info('GorgiasSync: Auto-reply sent', { context: { conversationId } });
        return;
      }

      // 4. P1 FIX: Use RetrievalOrchestrator for shared gate + evidence contract.
      //    This is the same orchestrator used by simulation and conversation routes,
      //    ensuring three-way consistency and preventing ungraded candidates from
      //    becoming false citations.
      const orchestrator = new RetrievalOrchestrator();
      const historyMessages = await conversationService.listMessageHistory(conversationId, 20);
      const recentMessages = historyMessages.slice(-10).map(m => ({
        role: (m as unknown as { role: string }).role,
        content: (m as unknown as { content: string }).content,
      }));
      const retrievalResult = await orchestrator.retrieve(userMessage, recentMessages, { useHybrid: true });
      const { evidence: evidenceBundle } = retrievalResult;
      const orchestratorCitations = evidenceBundle.citations;

      // 5. Normalize orchestrator output to legacy LLM context shape (for LLMStreamingService)
      const knowledgeResult = retrievalResult.knowledgeContext
        ? {
            context: retrievalResult.knowledgeContext.context,
            sources: retrievalResult.knowledgeContext.knowledgeSources,
            confidence: retrievalResult.knowledgeContext.confidence,
            images: retrievalResult.knowledgeContext.images,
          }
        : { context: '', sources: [], confidence: 0, images: [] };
      const productContext = retrievalResult.productContext?.productContext ?? '';
      const sizeChartContext = retrievalResult.sizeChartContext?.sizeChartContext ?? '';

      // 6. Get settings
      const settingsService = new SettingsService();
      const appSettings = await settingsService.getSettingsMap();

      // 7. Create LLM stream and collect full response.
      //    P0: Pass orchestrator-graded evidenceCitations as the canonical source list.
      //    Raw knowledgeSources are NOT forwarded to avoid false citation attribution.
      const llmStreamingService = new LLMStreamingService();
      const stream = llmStreamingService.createStream(conversationId, userMessage, historyMessages, {
        // LLM context (for generation) — still useful even if citations are empty
        knowledgeContext: knowledgeResult.context || undefined,
        knowledgeConfidence: knowledgeResult.confidence,
        // CANONICAL citations from orchestrator — these are the ONLY public sources
        evidenceCitations: orchestratorCitations.length > 0
          ? orchestratorCitations
          : undefined,
        knowledgeImages: knowledgeResult.images,
        productContext: productContext || undefined,
        sizeChartContext: sizeChartContext || undefined,
        knowledgeMinScore: retrievalResult.minScore,
        retrievalTrace: evidenceBundle.trace
          ? {
              action: retrievalResult.decision.action,
              reasonCode: retrievalResult.decision.reasonCode,
              provenanceVersion: evidenceBundle.trace.provenanceVersion,
              rerankDegraded: evidenceBundle.trace.rerankDegraded,
              candidateCount: evidenceBundle.candidates.length,
              citationCount: evidenceBundle.citations.length,
            }
          : undefined,
        aiModel: appSettings.ai_model_enabled === 'false'
          ? undefined
          : appSettings.ai_model,
        systemPrompt: appSettings.system_prompt || undefined,
        temperature: appSettings.ai_temperature ? parseFloat(appSettings.ai_temperature) : undefined,
        maxTokens: appSettings.ai_max_tokens ? parseInt(appSettings.ai_max_tokens, 10) : undefined,
      });

      // Consume the stream (the LLMStreamingService handles saving the assistant message internally)
      const reader = stream.getReader();
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }

      logger.info('GorgiasSync: AI reply completed', { context: { conversationId } });

      // 更新去重标记为完成时间
      GorgiasSyncService.lastAIReplyTime.set(conversationId, Date.now());
    } catch (error) {
      logger.error('GorgiasSync: triggerAIReply failed', {
        context: { conversationId, error: error instanceof Error ? error.message : String(error) }
      });

      // 失败时清除去重标记，允许后续重试
      GorgiasSyncService.lastAIReplyTime.delete(conversationId);
    }
  }
}

// 导出单例
export const gorgiasSyncService = new GorgiasSyncService();
