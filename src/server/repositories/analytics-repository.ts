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
      // 使用 count() 聚合查询，避免全表扫描 + JS 过滤
      const [totalResult, unresolvedResult, criticalResult, warningResult, infoResult] = await Promise.all([
        this.client.from('alerts').select('id', { count: 'exact', head: true }),
        this.client.from('alerts').select('id', { count: 'exact', head: true }).eq('is_resolved', false),
        this.client.from('alerts').select('id', { count: 'exact', head: true }).eq('is_resolved', false).eq('severity', 'critical'),
        this.client.from('alerts').select('id', { count: 'exact', head: true }).eq('is_resolved', false).eq('severity', 'warning'),
        this.client.from('alerts').select('id', { count: 'exact', head: true }).eq('is_resolved', false).eq('severity', 'info'),
      ]);

      if (totalResult.error) throw new RepositoryError('get alert stats', totalResult.error.message, totalResult.error.code);

      return {
        total: totalResult.count || 0,
        unresolved: unresolvedResult.count || 0,
        critical: criticalResult.count || 0,
        warning: warningResult.count || 0,
        info: infoResult.count || 0,
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
      // 限制近 90 天，避免全量加载历史评分数据
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data, error } = await this.client
        .from('conversations')
        .select('rating, source')
        .not('rating', 'is', null)
        .gte('created_at', ninetyDaysAgo.toISOString());

      if (error) throw new RepositoryError('get ratings by source', error.message, error.code);
      return (data ?? []) as RatingBySource[];
    } catch (error) {
      logger.database.error('getRatingsBySource failed, returning empty array', { error });
      return [];
    }
  }

  // ============ Ticket Statistics ============

  async getTicketStats(
    slaResolveMinutes: Record<string, number> = {},
  ): Promise<{
    total: number;
    by_status: Record<string, number>;
    by_category: Record<string, number>;
    by_priority: Record<string, number>;
    avg_resolution_hours: number | null;
    avg_first_response_hours: number | null;
    overdue_count: number;
  }> {
    try {
      // 基础统计使用 count() 聚合，避免全表扫描
      const [ticketsCountResult, statusCountsResult, categoryCountsResult, priorityCountsResult] = await Promise.all([
        this.client.from('tickets').select('id', { count: 'exact', head: true }),
        this.client.from('tickets').select('status', { count: 'exact', head: true }),
        this.client.from('tickets').select('category', { count: 'exact', head: true }),
        this.client.from('tickets').select('priority', { count: 'exact', head: true }),
      ]);

      const total = ticketsCountResult.count || 0;

      const byStatus: Record<string, number> = {};
      if (statusCountsResult.data) {
        for (const t of statusCountsResult.data as Array<{ status: string }>) {
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        }
      }

      const byCategory: Record<string, number> = {};
      if (categoryCountsResult.data) {
        for (const t of categoryCountsResult.data as Array<{ category: string }>) {
          byCategory[t.category] = (byCategory[t.category] || 0) + 1;
        }
      }

      const byPriority: Record<string, number> = {};
      if (priorityCountsResult.data) {
        for (const t of priorityCountsResult.data as Array<{ priority: string }>) {
          byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
        }
      }

      // 计算超时工单：按优先级 SLA 动态判断
      let overdue_count = 0;
      if (Object.keys(slaResolveMinutes).length > 0) {
        // 有 SLA 配置，按优先级阈值计算超时
        const openTicketsResult = await this.client
          .from('tickets')
          .select('id, priority, created_at')
          .in('status', ['open', 'in_progress']);

        if (!openTicketsResult.error && openTicketsResult.data) {
          const now = Date.now();
          for (const t of openTicketsResult.data as Array<{ id: string; priority: string; created_at: string }>) {
            const slaMinutes = slaResolveMinutes[t.priority] ?? slaResolveMinutes['low'] ?? 2880;
            const slaMs = slaMinutes * 60 * 1000;
            if (now - new Date(t.created_at).getTime() > slaMs) {
              overdue_count++;
            }
          }
        }
      } else {
        // 无 SLA 配置，回退到默认 24h 阈值
        const overdueResult = await this.client
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .or(`status.eq.open,status.eq.in_progress`)
          .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        overdue_count = overdueResult.count || 0;
      }

      // 平均处理时长：只加载已关闭工单（有限数量，防止大表爆炸）
      const resolvedTicketsResult = await this.client
        .from('tickets')
        .select('created_at, updated_at')
        .in('status', ['closed', 'resolved'])
        .order('updated_at', { ascending: false })
        .limit(1000);

      let totalResolutionMs = 0;
      let resolvedCount = 0;
      if (resolvedTicketsResult.data) {
        for (const t of resolvedTicketsResult.data as Array<{ created_at: string; updated_at: string }>) {
          totalResolutionMs += new Date(t.updated_at).getTime() - new Date(t.created_at).getTime();
          resolvedCount++;
        }
      }

      // 平均首次响应时长：只加载有状态日志的工单
      const firstResponseLogsResult = await this.client
        .from('ticket_status_log')
        .select('ticket_id, created_at')
        .eq('to_status', 'in_progress')
        .order('created_at', { ascending: true });

      if (firstResponseLogsResult.error) {
        logger.database.warn('getTicketStats: firstResponseLogs query failed', { error: firstResponseLogsResult.error });
      }

      const ticketCreatedMap = new Map<string, string>();
      if (resolvedTicketsResult.data) {
        for (const t of resolvedTicketsResult.data as Array<{ created_at: string; id?: string }>) {
          // We don't have id here, skip - already have created_at in ticket_status_log
        }
      }

      const firstResponseMap = new Map<string, string>();
      if (firstResponseLogsResult.data) {
        for (const log of firstResponseLogsResult.data as Array<{ ticket_id: string; created_at: string }>) {
          if (!firstResponseMap.has(log.ticket_id)) {
            firstResponseMap.set(log.ticket_id, log.created_at);
          }
        }
      }

      let totalFirstResponseMs = 0;
      let firstResponseCount = 0;
      if (firstResponseMap.size > 0) {
        // 批量查询工单创建时间（仅取有首次响应的工单）
        const ticketIds = Array.from(firstResponseMap.keys());
        const ticketsWithCreatedResult = await this.client
          .from('tickets')
          .select('id, created_at')
          .in('id', ticketIds)
          .limit(500);

        if (!ticketsWithCreatedResult.error && ticketsWithCreatedResult.data) {
          for (const t of ticketsWithCreatedResult.data as Array<{ id: string; created_at: string }>) {
            ticketCreatedMap.set(t.id, t.created_at);
          }
        }
      }
      for (const [ticketId, firstResponseAt] of firstResponseMap) {
        const created = ticketCreatedMap.get(ticketId);
        if (created) {
          totalFirstResponseMs += new Date(firstResponseAt).getTime() - new Date(created).getTime();
          firstResponseCount++;
        }
      }

      return {
        total,
        by_status: byStatus,
        by_category: byCategory,
        by_priority: byPriority,
        avg_resolution_hours: resolvedCount > 0 ? (totalResolutionMs / resolvedCount) / (1000 * 60 * 60) : null,
        avg_first_response_hours: firstResponseCount > 0 ? (totalFirstResponseMs / firstResponseCount) / (1000 * 60 * 60) : null,
        overdue_count,
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
      // 只查询已关闭工单（有限数量），避免全表扫描
      const { data, error } = await this.client
        .from('tickets')
        .select('assignee_id, status, created_at, updated_at')
        .not('assignee_id', 'is', null)
        .in('status', ['closed', 'resolved'])
        .order('updated_at', { ascending: false })
        .limit(5000);

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
