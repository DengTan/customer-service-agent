import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

// ============================================
// Types
// ============================================

export interface AgentAssignmentStatsRow {
  id: string;
  user_id: string;
  date: string;
  assigned_count: number;
  active_conversations: number;
  completed_count: number;
  last_assigned_at: string | null;
  created_at: string;
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

// ============================================
// Repository
// ============================================

export class AgentAssignmentStatsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  // ==========================================
  // Stats CRUD
  // ==========================================

  async getOrCreateTodayStats(userId: string): Promise<AgentAssignmentStatsRow> {
    if (isDemoMode()) {
      return {
        id: `demo-stats-${userId}`,
        user_id: userId,
        date: this.getToday(),
        assigned_count: 0,
        active_conversations: 0,
        completed_count: 0,
        last_assigned_at: null,
        created_at: new Date().toISOString(),
      };
    }

    const today = this.getToday();

    // Try to get existing stats
    const { data: existing, error: getError } = await this.client
      .from('agent_assignment_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (getError) throw new RepositoryError('get today stats', getError.message, getError.code);

    if (existing) return existing as AgentAssignmentStatsRow;

    // Create new stats for today
    const { data: created, error: createError } = await this.client
      .from('agent_assignment_stats')
      .insert({
        user_id: userId,
        date: today,
        assigned_count: 0,
        active_conversations: 0,
        completed_count: 0,
      })
      .select()
      .single();

    if (createError) throw new RepositoryError('create today stats', createError.message, createError.code);
    return created as AgentAssignmentStatsRow;
  }

  async getStatsByUserAndDate(userId: string, date: string): Promise<AgentAssignmentStatsRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('agent_assignment_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();

    if (error) throw new RepositoryError('get stats by user and date', error.message, error.code);
    return data as AgentAssignmentStatsRow | null;
  }

  /**
   * Batch get stats for multiple users on a specific date
   */
  async getStatsForUsers(userIds: string[], date: string): Promise<Map<string, AgentAssignmentStatsRow>> {
    if (isDemoMode()) return new Map();

    if (userIds.length === 0) return new Map();

    const { data, error } = await this.client
      .from('agent_assignment_stats')
      .select('*')
      .eq('date', date)
      .in('user_id', userIds);

    if (error) throw new RepositoryError('get stats for users', error.message, error.code);

    const map = new Map<string, AgentAssignmentStatsRow>();
    for (const row of (data ?? [])) {
      map.set((row as Record<string, unknown>).user_id as string, row as AgentAssignmentStatsRow);
    }
    return map;
  }

  // ==========================================
  // Increment/Decrement Operations
  // ==========================================

  /**
   * Increment assigned_count and update last_assigned_at
   */
  async incrementAssigned(userId: string): Promise<void> {
    if (isDemoMode()) return;

    const today = this.getToday();

    // Use upsert to ensure atomic increment
    await this.upsertStats(userId, today, {
      assigned_count: 1,
      last_assigned_at: new Date().toISOString(),
    });
  }

  /**
   * Increment active_conversations (when agent accepts a conversation)
   */
  async incrementActiveConversations(userId: string): Promise<void> {
    if (isDemoMode()) return;

    const today = this.getToday();
    const stats = await this.getOrCreateTodayStats(userId);

    await this.upsertStats(userId, today, {
      active_conversations: stats.active_conversations + 1,
    });
  }

  /**
   * Decrement active_conversations (when agent completes or transfers a conversation)
   */
  async decrementActiveConversations(userId: string): Promise<void> {
    if (isDemoMode()) return;

    const today = this.getToday();

    const stats = await this.getOrCreateTodayStats(userId);
    const newActive = Math.max(0, stats.active_conversations - 1);

    await this.upsertStats(userId, today, {
      active_conversations: newActive,
    });
  }

  /**
   * Increment completed_count (when agent completes a conversation)
   */
  async incrementCompleted(userId: string): Promise<void> {
    if (isDemoMode()) return;

    const today = this.getToday();

    await this.upsertStats(userId, today, {
      completed_count: 1,
    });
  }

  private async upsertStats(
    userId: string,
    date: string,
    increments: { assigned_count?: number; active_conversations?: number; completed_count?: number; last_assigned_at?: string }
  ): Promise<void> {
    // Use RPC function for atomic upsert to prevent race conditions
    const { error } = await this.client.rpc('upsert_agent_stats', {
      p_user_id: userId,
      p_date: date,
      p_assigned_delta: increments.assigned_count ?? 0,
      p_completed_delta: increments.completed_count ?? 0,
      p_last_assigned_at: increments.last_assigned_at ?? null,
    });

    if (error) {
      // Fallback: if RPC fails, try the original query-update approach
      const current = await this.getStatsByUserAndDate(userId, date);

      const updates: Record<string, unknown> = {
        assigned_count: (current?.assigned_count ?? 0) + (increments.assigned_count ?? 0),
        active_conversations: increments.active_conversations ?? current?.active_conversations ?? 0,
        completed_count: (current?.completed_count ?? 0) + (increments.completed_count ?? 0),
        last_assigned_at: increments.last_assigned_at ?? current?.last_assigned_at ?? null,
      };

      if (current) {
        const { error: updateError } = await this.client
          .from('agent_assignment_stats')
          .update(updates)
          .eq('user_id', userId)
          .eq('date', date);

        if (updateError) throw new RepositoryError('upsert stats', updateError.message, updateError.code);
      } else {
        const { error: insertError } = await this.client
          .from('agent_assignment_stats')
          .insert({
            user_id: userId,
            date: date,
            assigned_count: updates.assigned_count,
            active_conversations: updates.active_conversations,
            completed_count: updates.completed_count,
            last_assigned_at: updates.last_assigned_at,
          });

        if (insertError) throw new RepositoryError('upsert stats (insert)', insertError.message, insertError.code);
      }
    }
  }

  // ==========================================
  // Agent Status Query
  // ==========================================

  /**
   * Get all agents with their current status and stats
   */
  async getAllAgentsStatus(): Promise<{ agents: AgentStatusInfo[]; summary: AgentStatusSummary }> {
    if (isDemoMode()) {
      return {
        agents: [],
        summary: { total: 0, online: 0, away: 0, offline: 0, disconnected: 0 },
      };
    }

    const today = this.getToday();

    // Get all agents (users with agent role)
    const { data: users, error: usersError } = await this.client
      .from('users')
      .select('id, name, email')
      .eq('role', 'agent')
      .eq('status', 'active');

    if (usersError) throw new RepositoryError('get agents', usersError.message, usersError.code);
    if (!users || users.length === 0) {
      return {
        agents: [],
        summary: { total: 0, online: 0, away: 0, offline: 0, disconnected: 0 },
      };
    }

    const userIds = (users as Array<{ id: string; name: string; email: string }>).map(u => u.id);

    // Get latest agent sessions (one per user - handle multi-session)
    const { data: sessions, error: sessionsError } = await this.client
      .from('agent_sessions')
      .select('user_id, status, last_active_at, current_conversation_id')
      .in('user_id', userIds)
      .order('last_active_at', { ascending: false });

    if (sessionsError) throw new RepositoryError('get agent sessions', sessionsError.message, sessionsError.code);

    // Deduplicate sessions - keep only the latest for each user
    const sessionMap = new Map<string, { status: string; last_active_at: string | null; has_conversation: boolean }>();
    for (const s of sessions ?? []) {
      const userId = (s as Record<string, unknown>).user_id as string;
      // Only keep the first (most recent) session for each user
      if (!sessionMap.has(userId)) {
        sessionMap.set(userId, {
          status: (s as Record<string, unknown>).status as string,
          last_active_at: (s as Record<string, unknown>).last_active_at as string | null,
          has_conversation: !!(s as Record<string, unknown>).current_conversation_id,
        });
      }
    }

    // Get today's stats (gracefully handle table not existing)
    let stats: any[] = [];
    const { data: statsData, error: statsError } = await this.client
      .from('agent_assignment_stats')
      .select('*')
      .eq('date', today)
      .in('user_id', userIds);

    // If table doesn't exist (42P01) or PostgREST cache miss (PGRST205), use empty stats
    if (statsError) {
      if (statsError.code === '42P01' || statsError.code === 'PGRST205') {
        stats = [];
      } else {
        throw new RepositoryError('get today stats', statsError.message, statsError.code);
      }
    } else {
      stats = statsData ?? [];
    }

    // Get today's completed conversations count
    let completedData: any[] = [];
    const { data: completedResult, error: completedError } = await this.client
      .from('agent_queue')
      .select('assigned_agent_id')
      .eq('status', 'resolved')
      .gte('resolved_at', `${today}T00:00:00`)
      .in('assigned_agent_id', userIds);

    // If table doesn't exist or PostgREST cache miss, use empty data
    if (completedError) {
      if (completedError.code === '42P01' || completedError.code === 'PGRST205') {
        completedData = [];
      } else {
        throw new RepositoryError('get completed count', completedError.message, completedError.code);
      }
    } else {
      completedData = completedResult ?? [];
    }

    // Build stats map
    const statsMap = new Map<string, AgentAssignmentStatsRow>();
    for (const st of stats ?? []) {
      statsMap.set((st as Record<string, unknown>).user_id as string, st as AgentAssignmentStatsRow);
    }

    // Build completed count map
    const completedMap = new Map<string, number>();
    for (const c of completedData ?? []) {
      const agentId = (c as Record<string, unknown>).assigned_agent_id as string;
      completedMap.set(agentId, (completedMap.get(agentId) ?? 0) + 1);
    }

    // Build agent list
    const agents: AgentStatusInfo[] = [];
    const summary: AgentStatusSummary = { total: userIds.length, online: 0, away: 0, offline: 0, disconnected: 0 };

    for (const user of users as Array<{ id: string; name: string; email: string }>) {
      const session = sessionMap.get(user.id);
      const stats = statsMap.get(user.id);

      let status: AgentStatusInfo['status'];
      if (!session) {
        status = 'disconnected';
        summary.disconnected++;
      } else if (session.status === 'online') {
        status = 'online';
        summary.online++;
      } else if (session.status === 'away') {
        status = 'away';
        summary.away++;
      } else {
        status = 'offline';
        summary.offline++;
      }

      // Use stats active_conversations if available, otherwise 0
      const currentConversations = stats?.active_conversations ?? 0;

      agents.push({
        user_id: user.id,
        name: user.name,
        email: user.email,
        status,
        current_conversations: currentConversations,
        today_completed: completedMap.get(user.id) ?? stats?.completed_count ?? 0,
        today_assigned: stats?.assigned_count ?? 0,
        last_active_at: session?.last_active_at ?? null,
      });
    }

    return { agents, summary };
  }
}
