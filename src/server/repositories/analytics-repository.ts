import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { AlertRow } from './types';
import { toAlertRow } from './types';
import { logger } from '@/lib/logger';

/**
 * Analytics Repository
 * 
 * 提供数据分析和统计相关的数据访问方法。
 * 核心指标、趋势图、来源分布、告警统计等。
 * 
 * 性能策略：
 * - 聚合统计优先使用 Supabase RPC 函数（避免全表扫描）
 * - Demo 模式返回空数据结构（不返回假数据）
 * 
 * 错误处理策略：
 * - 默认抛出异常（RepositoryError），由上层（Service/Route）决定如何处理
 * - 可通过 fallbackOnError 参数启用静默降级（返回空数据），用于非关键查询
 * - 日志记录始终执行，无论是否启用 fallback
 */

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

/**
 * AnalyticsRepository 数据分析仓储类
 * 
 * 封装所有数据分析相关的数据库查询，包括：
 * - 核心指标（对话数/消息数/活跃会话/平均评分）
 * - 来源分布（web/qianniu/doudian）
 * - 告警统计（总数/未处理/严重等级）
 * - 趋势数据（满意度趋势/工单趋势）
 * - 工单统计（按状态/分类/优先级/坐席）
 */
export class AnalyticsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * 获取核心指标数据
   * @param fallbackOnError 设为 true 时，查询失败返回零值而非抛出异常（用于非关键指标展示）
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getCoreMetrics(fallbackOnError = false): Promise<{
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
      logger.database.error('getCoreMetrics failed', { error });
      if (fallbackOnError) {
        return {
          totalConversations: 0,
          totalMessages: 0,
          activeConversations: 0,
          todayConversations: 0,
          ratings: [],
          avgRating: 0,
        };
      }
      throw error;
    }
  }

  /**
   * 获取近期对话列表
   * @param sinceIso ISO 8601 时间戳
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getRecentConversations(sinceIso: string, fallbackOnError = false): Promise<RecentConversation[]> {
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
      logger.database.error('getRecentConversations failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }

  /**
   * 获取来源分布统计
   * @param fallbackOnError 设为 true 时，查询失败返回空对象而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getSourceDistribution(fallbackOnError = false): Promise<Record<string, number>> {
    // Demo 模式返回空对象，饼图将显示"暂无数据"
    if (isDemoMode()) {
      return {};
    }

    try {
      // Use RPC for database-level aggregation (P2 performance fix: replaces full scan + JS forEach)
      const { data, error } = await this.client.rpc('get_source_distribution');
      if (error) throw new RepositoryError('get source distribution', error.message, error.code);
      return (data as Record<string, number>) || {};
    } catch (error) {
      logger.database.error('getSourceDistribution failed', { error });
      if (fallbackOnError) return {};
      throw error;
    }
  }

  /**
   * 获取近期消息列表
   * @param sinceIso ISO 8601 时间戳
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getRecentMessages(sinceIso: string, fallbackOnError = false): Promise<RecentMessage[]> {
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
      logger.database.error('getRecentMessages failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }

  /**
   * 获取自动回复命中次数
   * @param fallbackOnError 设为 true 时，查询失败返回 0 而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getAutoReplyHits(fallbackOnError = false): Promise<number> {
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
      logger.database.error('getAutoReplyHits failed', { error });
      if (fallbackOnError) return 0;
      throw error;
    }
  }

  /**
   * 获取告警统计数据
   * @param fallbackOnError 设为 true 时，查询失败返回零值而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getAlertStats(fallbackOnError = false): Promise<{
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
      logger.database.error('getAlertStats failed', { error });
      if (fallbackOnError) {
        return {
          total: 0,
          unresolved: 0,
          critical: 0,
          warning: 0,
          info: 0,
        };
      }
      throw error;
    }
  }

  /**
   * 获取近期告警列表
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getRecentAlerts(fallbackOnError = false): Promise<AlertRow[]> {
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
      logger.database.error('getRecentAlerts failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }

  /**
   * 获取转人工次数
   * @param fallbackOnError 设为 true 时，查询失败返回 0 而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getHandoffCount(fallbackOnError = false): Promise<number> {
    // Demo 模式返回 0
    if (isDemoMode()) {
      return 0;
    }

    try {
      const { count, error } = await this.client
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'handoff');

      if (error) throw new RepositoryError('get handoff count', error.message, error.code);
      return count ?? 0;
    } catch (error) {
      logger.database.error('getHandoffCount failed', { error });
      if (fallbackOnError) return 0;
      throw error;
    }
  }

  /**
   * 获取带日期的评分列表
   * @param sinceIso ISO 8601 时间戳
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getRatingsWithDate(sinceIso: string, fallbackOnError = false): Promise<RatingWithDate[]> {
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
      logger.database.error('getRatingsWithDate failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }

  /**
   * 获取按来源分组的评分列表
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getRatingsBySource(fallbackOnError = false): Promise<RatingBySource[]> {
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
      logger.database.error('getRatingsBySource failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }

  // ============ Ticket Statistics ============

  /**
   * 获取工单统计数据
   * @param slaResolveMinutes SLA 配置，按优先级设置超时阈值（分钟）
   * @param fallbackOnError 设为 true 时，查询失败返回零值而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getTicketStats(
    slaResolveMinutes: Record<string, number> = {},
    fallbackOnError = false,
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
      // Use RPC for database-level aggregation (P2 performance fix: replaces count + JS loop)
      const { data: statsData, error: statsError } = await this.client.rpc('get_ticket_stats');
      if (statsError) throw new RepositoryError('get ticket stats', statsError.message, statsError.code);

      const byStatus = (statsData?.by_status as Record<string, number>) || {};
      const byCategory = (statsData?.by_category as Record<string, number>) || {};
      const byPriority = (statsData?.by_priority as Record<string, number>) || {};
      const total = (statsData?.total as number) || 0;

      // 计算超时工单：按优先级 SLA 动态判断
      // P2-2 fix: 一律走数据库侧聚合，避免拉所有 open+in_progress 工单到 JS 循环
      let overdue_count = 0;
      if (Object.keys(slaResolveMinutes).length > 0) {
        // 有 SLA 配置：调用 RPC 用 SQL 侧 JOIN 计算
        const { data: overdueData, error: overdueError } = await this.client.rpc(
          'get_ticket_overdue_count',
          { p_sla_config: slaResolveMinutes as unknown as never },
        );
        if (overdueError) {
          // RPC 失败：抛出，由 fallbackOnError 决定是否降级
          throw new RepositoryError('get_ticket_overdue_count', overdueError.message, overdueError.code);
        }
        overdue_count = (overdueData as number) ?? 0;
      } else {
        // 无 SLA 配置：回退到数据库 count 查询（24h 默认），保留相同精确值
        const overdueResult = await this.client
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .or('status.eq.open,status.eq.in_progress')
          .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        if (overdueResult.error) {
          throw new RepositoryError('get overdue count', overdueResult.error.message, overdueResult.error.code);
        }
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
      if (fallbackOnError) {
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
      throw error;
    }
  }

  /**
   * 获取工单趋势数据
   * @param days 统计天数，默认 7 天
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getTicketTrend(days: number = 7, fallbackOnError = false): Promise<Array<{ date: string; created: number; closed: number }>> {
    if (isDemoMode()) {
      return [];
    }
    try {
      const { data, error } = await this.client.rpc('get_ticket_trend', { days });
      if (error) throw new RepositoryError('get ticket trend', error.message, error.code);
      return (data as Array<{ date: string; created: number; closed: number }>) || [];
    } catch (error) {
      logger.database.error('getTicketTrend failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }

  /**
   * 获取坐席工单统计
   * @param fallbackOnError 设为 true 时，查询失败返回空数组而非抛出异常
   * @throws {RepositoryError} 当 fallbackOnError=false 且数据库查询失败时
   */
  async getAgentTicketStats(fallbackOnError = false): Promise<Array<{ assignee_id: string; total: number; resolved: number; avg_resolution_hours: number }>> {
    if (isDemoMode()) {
      return [];
    }
    try {
      const { data, error } = await this.client.rpc('get_agent_ticket_stats');
      if (error) throw new RepositoryError('get agent ticket stats', error.message, error.code);

      const raw = data as Record<string, { completed: number; avg_handle_time: number; overdue_count: number }> | null;
      if (!raw) return [];

      return Object.entries(raw).map(([assignee_id, stats]) => ({
        assignee_id,
        total: stats.completed,
        resolved: stats.completed,
        avg_resolution_hours: stats.avg_handle_time ?? 0,
      }));
    } catch (error) {
      logger.database.error('getAgentTicketStats failed', { error });
      if (fallbackOnError) return [];
      throw error;
    }
  }
}
