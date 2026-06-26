import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { AlertRow } from './types';
import { toAlertRow } from './types';
import { DEMO_ALERTS } from './demo-data/demo-alerts';
import { logger } from '@/lib/logger';
import {
  DEMO_METRICS,
  DEMO_SOURCE_DISTRIBUTION,
  DEMO_HANDOVER_COUNT,
} from './demo-data/demo-analytics';

export interface ConversationMessage {
  created_at: string;
  rating: number | null;
  source?: string | null;
}

export interface RecentConversation {
  created_at: string;
}

export interface RecentMessage {
  created_at: string;
  role: string;
}

export interface AutoReplyMessage {
  sources: unknown;
}

export interface RecentAlert {
  id: string;
  conversation_id: string;
  type: string;
  severity: string;
  message: string;
  is_resolved: boolean;
  created_at: string;
  conversations?: { id: string; title: string; status: string } | null;
}

export interface HandoffConversation {
  id: string;
}

export interface RatingWithDate {
  rating: number | null;
  created_at: string;
}

export interface RatingBySource {
  rating: number | null;
  source: string | null;
}

/** 数据库查询类型定义 */
export interface ConversationSource {
  source: string | null;
}

export interface TicketRow {
  id: string;
  status: string;
  category: string;
  priority: string;
  created_at: string;
  updated_at: string;
  assignee_id?: string | null;
}

export interface TicketStatusLogRow {
  ticket_id: string;
  to_status: string;
  created_at: string;
}

export class AnalyticsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async getCoreMetrics(): Promise<{
    totalConversations: number;
    totalMessages: number;
    activeConversations: number;
    todayConversations: number;
    ratings: Array<{ rating: number | null }>;
    avgRating: number;
  }> {
    // Demo 模式返回零值，避免假数据泄漏到生产环境
    if (isDemoMode()) {
      return {
        totalConversations: 0,
        totalMessages: 0,
        activeConversations: 0,
        todayConversations: 0,
        ratings: [],
        avgRating: 0,
      };
    }
    
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Parallel queries are intentional here - 5 parallel queries is more efficient than
      // a complex RPC that would need to aggregate across multiple tables.
      // The performance gain from merging into 1 query is minimal vs. the complexity risk.
      const [conversationsRes, messagesRes, ratingsRes, activeConvRes, todayConvRes] = await Promise.all([
        this.client.from('conversations').select('id', { count: 'exact', head: true }),
        this.client.from('messages').select('id', { count: 'exact', head: true }),
        this.client.from('conversations').select('rating').not('rating', 'is', null),
        this.client.from('conversations').select('id').eq('status', 'active'),
        this.client.from('conversations').select('id').gte('created_at', todayStart.toISOString()),
      ]);

      if (conversationsRes.error) throw new RepositoryError('get total conversations count', conversationsRes.error.message, conversationsRes.error.code);
      if (messagesRes.error) throw new RepositoryError('get total messages count', messagesRes.error.message, messagesRes.error.code);
      if (ratingsRes.error) throw new RepositoryError('get ratings', ratingsRes.error.message, ratingsRes.error.code);
      if (activeConvRes.error) throw new RepositoryError('get active conversations', activeConvRes.error.message, activeConvRes.error.code);
      if (todayConvRes.error) throw new RepositoryError('get today conversations', todayConvRes.error.message, todayConvRes.error.code);

      const totalConversations = conversationsRes.count || 0;
      const totalMessages = messagesRes.count || 0;
      const activeConversations = activeConvRes.data?.length || 0;
      const todayConversations = todayConvRes.data?.length || 0;
      const ratings = ratingsRes.data || [];
      const avgRating =
        ratings.length > 0
          ? ratings.reduce((sum, r) => sum + (r.rating || 0), 0) / ratings.length
          : 0;

      return { totalConversations, totalMessages, activeConversations, todayConversations, ratings, avgRating };
    } catch (error) {
      logger.database.error('getCoreMetrics failed, returning empty metrics', { error });
      return {
        totalConversations: 0,
        totalMessages: 0,
        activeConversations: 0,
        todayConversations: 0,
        ratings: [],
        avgRating: 0,
      };
    }
  }

  async getRecentConversations(sinceIso: string): Promise<RecentConversation[]> {
    // Demo 模式返回空数组，趋势图将显示"暂无数据"
    if (isDemoMode()) {
      return [];
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true });

      if (error) throw new RepositoryError('get recent conversations', error.message, error.code);
      return (data ?? []) as RecentConversation[];
    } catch (error) {
      logger.database.error('getRecentConversations failed, returning empty array', { error });
      return [];
    }
  }

  async getSourceDistribution(): Promise<Record<string, number>> {
    // Demo 模式返回空对象，饼图将显示"暂无数据"
    if (isDemoMode()) {
      return {};
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('source')
        .returns<ConversationSource[]>();
      if (error) throw new RepositoryError('get source distribution', error.message, error.code);

      const distribution: Record<string, number> = {};
      (data || []).forEach((c) => {
        const source = c.source || 'web';
        distribution[source] = (distribution[source] || 0) + 1;
      });
      return distribution;
    } catch (error) {
      logger.database.error('getSourceDistribution failed, returning empty', { error });
      return {};
    }
  }

  async getRecentMessages(sinceIso: string): Promise<RecentMessage[]> {
    if (isDemoMode()) {
      return [];
    }
    
    try {
      const { data, error } = await this.client
        .from('messages')
        .select('created_at, role')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true });

      if (error) throw new RepositoryError('get recent messages', error.message, error.code);
      return (data ?? []) as RecentMessage[];
    } catch (error) {
      logger.database.error('getRecentMessages failed, returning empty array', { error });
      return [];
    }
  }

  async getAutoReplyHits(): Promise<number> {
    // Demo 模式返回 0，避免假数据误导
    if (isDemoMode()) {
      return 0;
    }
    
    try {
      const { data, error } = await this.client
        .from('messages')
        .select('sources')
        .not('sources', 'is', null);

      if (error) throw new RepositoryError('get auto reply messages', error.message, error.code);

      return (data || []).filter((m) => {
        const msg = m as AutoReplyMessage;
        return (
          msg.sources &&
          Array.isArray(msg.sources) &&
          (msg.sources as Array<{ type: string }>).some((s) => s.type === 'auto_reply')
        );
      }).length;
    } catch (error) {
      logger.database.error('getAutoReplyHits failed, returning 0', { error });
      return 0;
    }
  }

  async getAlertStats(): Promise<{
    total: number;
    unresolved: number;
    critical: number;
    warning: number;
    info: number;
  }> {
    // Demo 模式返回零值，告警区将显示"暂无异常告警"
    if (isDemoMode()) {
      return {
        total: 0,
        unresolved: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };
    }
    
    try {
      const { data, error } = await this.client
        .from('alerts')
        .select('severity, is_resolved, type')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw new RepositoryError('get alert stats', error.message, error.code);

      const alerts = (data || []) as AlertRow[];
      const unresolvedAlerts = alerts.filter((a) => !a.is_resolved);
      return {
        total: alerts.length,
        unresolved: unresolvedAlerts.length,
        critical: unresolvedAlerts.filter((a) => a.severity === 'critical').length,
        warning: unresolvedAlerts.filter((a) => a.severity === 'warning').length,
        info: unresolvedAlerts.filter((a) => a.severity === 'info').length,
      };
    } catch (error) {
      logger.database.error('getAlertStats failed, returning empty stats', { error });
      return {
        total: 0,
        unresolved: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };
    }
  }

  async getRecentAlerts(): Promise<AlertRow[]> {
    // Demo 模式返回空数组
    if (isDemoMode()) {
      return [];
    }
    
    try {
      // 由于 alerts.conversation_id 与 conversations 之间没有外键约束，直接查询 alerts 表
      const { data, error } = await this.client
        .from('alerts')
        .select('id, conversation_id, type, severity, message, is_resolved, created_at')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw new RepositoryError('get recent alerts', error.message, error.code);
      return (data ?? []).map(toAlertRow);
    } catch (error) {
      logger.database.error('getRecentAlerts failed, returning empty array', { error });
      return [];
    }
  }

  async getHandoffCount(): Promise<number> {
    // Demo 模式返回 0
    if (isDemoMode()) {
      return 0;
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('id')
        .eq('status', 'handoff');

      if (error) throw new RepositoryError('get handoff count', error.message, error.code);
      return data?.length || 0;
    } catch (error) {
      logger.database.error('getHandoffCount failed, returning 0', { error });
      return 0;
    }
  }

  async getRatingsWithDate(sinceIso: string): Promise<RatingWithDate[]> {
    // Demo 模式返回空数组，满意度趋势图将显示"暂无满意度数据"
    if (isDemoMode()) {
      return [];
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('rating, created_at')
        .not('rating', 'is', null)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true });

      if (error) throw new RepositoryError('get ratings with date', error.message, error.code);
      return (data ?? []) as RatingWithDate[];
    } catch (error) {
      logger.database.error('getRatingsWithDate failed, returning empty array', { error });
      return [];
    }
  }

  async getRatingsBySource(): Promise<RatingBySource[]> {
    // Demo 模式返回空数组，各渠道满意度将显示"暂无数据"
    if (isDemoMode()) {
      return [];
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('rating, source')
        .not('rating', 'is', null);

      if (error) throw new RepositoryError('get ratings by source', error.message, error.code);
      return (data ?? []) as RatingBySource[];
    } catch (error) {
      logger.database.error('getRatingsBySource failed, returning empty array', { error });
      return [];
    }
  }

  // ============ Ticket Statistics ============

  async getTicketStats(): Promise<{
    total: number;
    by_status: Record<string, number>;
    by_category: Record<string, number>;
    by_priority: Record<string, number>;
    avg_resolution_hours: number | null;
    avg_first_response_hours: number | null;
    overdue_count: number;
  }> {
    try {
      // 并行查询 tickets 和 ticket_status_log（使用类型化返回）
      const [ticketsResult, statusLogsResult] = await Promise.all([
        this.client
          .from('tickets')
          .select('id, status, category, priority, created_at, updated_at')
          .returns<TicketRow[]>(),
        this.client
          .from('ticket_status_log')
          .select('ticket_id, to_status, created_at')
          .eq('to_status', 'in_progress')
          .returns<TicketStatusLogRow[]>(),
      ]);

      if (ticketsResult.error) throw new RepositoryError('get ticket stats', ticketsResult.error.message, ticketsResult.error.code);

      const tickets = ticketsResult.data || [];
      const statusLogs = statusLogsResult.data || [];

      // 使用 Map 存储 ticket 创建时间，O(1) 查找
      const ticketCreatedMap = new Map<string, string>();
      for (const t of tickets) {
        ticketCreatedMap.set(t.id, t.created_at);
      }

      // 构建 earliest first_response per ticket
      const firstResponseMap = new Map<string, string>();
      for (const log of statusLogs) {
        if (!firstResponseMap.has(log.ticket_id)) {
          firstResponseMap.set(log.ticket_id, log.created_at);
        }
      }

      // 单次循环计算所有统计
      const byStatus: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      let totalResolutionMs = 0;
      let resolvedCount = 0;
      let totalFirstResponseMs = 0;
      let firstResponseCount = 0;
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      for (const t of tickets) {
        // 统计 by status/category/priority
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        byCategory[t.category] = (byCategory[t.category] || 0) + 1;
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;

        // 计算平均处理时长（closed/resolved）
        if (t.status === 'closed' || t.status === 'resolved') {
          const created = new Date(t.created_at).getTime();
          const updated = new Date(t.updated_at).getTime();
          totalResolutionMs += updated - created;
          resolvedCount++;
        }

        // 计算平均首次响应时长
        const firstResponseAt = firstResponseMap.get(t.id);
        if (firstResponseAt) {
          const created = ticketCreatedMap.get(t.id);
          if (created) {
            const createdMs = new Date(created).getTime();
            const respondedMs = new Date(firstResponseAt).getTime();
            totalFirstResponseMs += respondedMs - createdMs;
            firstResponseCount++;
          }
        }
      }

      // 超时工单数
      const overdueCount = tickets.filter(t =>
        (t.status === 'open' || t.status === 'in_progress') && t.created_at < oneDayAgo
      ).length;

      return {
        total: tickets.length,
        by_status: byStatus,
        by_category: byCategory,
        by_priority: byPriority,
        avg_resolution_hours: resolvedCount > 0 ? (totalResolutionMs / resolvedCount) / (1000 * 60 * 60) : null,
        avg_first_response_hours: firstResponseCount > 0 ? (totalFirstResponseMs / firstResponseCount) / (1000 * 60 * 60) : null,
        overdue_count: overdueCount,
      };
    } catch (error) {
      logger.database.error('getTicketStats failed', { error });
      return {
        total: 0,
        by_status: {},
        by_category: {},
        by_priority: {},
        avg_resolution_hours: null,
        avg_first_response_hours: null,
        overdue_count: 0,
      };
    }
  }

  async getTicketTrend(days: number = 7): Promise<Array<{ date: string; created: number; closed: number }>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await this.client
        .from('tickets')
        .select('created_at, updated_at, status')
        .gte('created_at', startDate.toISOString());

      if (error) throw new RepositoryError('get ticket trend', error.message, error.code);

      const tickets = data || [];
      const trend: Array<{ date: string; created: number; closed: number }> = [];

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        // 使用日期范围比较，避免时区问题
        const dayStart = `${dateStr}T00:00:00`;
        const dayEnd = `${dateStr}T23:59:59`;

        const created = tickets.filter(t => 
          t.created_at >= dayStart && t.created_at <= dayEnd
        ).length;
        const closed = tickets.filter(t =>
          (t.status === 'closed' || t.status === 'resolved') && 
          t.updated_at >= dayStart && t.updated_at <= dayEnd
        ).length;

        trend.push({ date: dateStr, created, closed });
      }

      return trend;
    } catch (error) {
      logger.database.error('getTicketTrend failed', { error });
      return [];
    }
  }

  async getAgentTicketStats(): Promise<Array<{ assignee_id: string; total: number; resolved: number; avg_resolution_hours: number }>> {
    try {
      const { data, error } = await this.client
        .from('tickets')
        .select('assignee_id, status, created_at, updated_at')
        .not('assignee_id', 'is', null)
        .returns<TicketRow[]>();

      if (error) throw new RepositoryError('get agent ticket stats', error.message, error.code);

      const tickets = data || [];
      const agentMap = new Map<string, { total: number; resolved: number; totalResolutionMs: number }>();

      for (const t of tickets) {
        const aid = t.assignee_id!;
        if (!agentMap.has(aid)) {
          agentMap.set(aid, { total: 0, resolved: 0, totalResolutionMs: 0 });
        }
        const stats = agentMap.get(aid)!;
        stats.total++;
        if (t.status === 'closed' || t.status === 'resolved') {
          stats.resolved++;
          stats.totalResolutionMs += new Date(t.updated_at).getTime() - new Date(t.created_at).getTime();
        }
      }

      return Array.from(agentMap.entries()).map(([assignee_id, stats]) => ({
        assignee_id,
        total: stats.total,
        resolved: stats.resolved,
        avg_resolution_hours: stats.resolved > 0 ? (stats.totalResolutionMs / stats.resolved) / (1000 * 60 * 60) : 0,
      }));
    } catch (error) {
      logger.database.error('getAgentTicketStats failed', { error });
      return [];
    }
  }
}
