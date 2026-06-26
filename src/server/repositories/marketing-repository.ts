import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { DEMO_CAMPAIGNS } from './demo-data/demo-marketing';

export interface MarketingCampaignRow {
  id: string;
  name: string;
  type: string;
  target_segment: unknown;
  bot_id: string | null;
  status: string;
  ab_variants: unknown | null;
  message_template: string | null;
  trigger_type: 'manual' | 'scheduled' | 'event';
  scheduled_at: string | null;
  trigger_config: unknown | null;
  created_at: string;
  updated_at?: string;
}

// Demo 数据的可变本地副本（避免修改导入的常量）
const _demoCampaigns = [...(DEMO_CAMPAIGNS as MarketingCampaignRow[])];

export interface CampaignStats {
  sent: number;
  replied: number;
  converted: number;
}

export interface CampaignWithStats extends MarketingCampaignRow {
  stats: CampaignStats;
}

export interface CreateCampaignInput {
  name: string;
  type: string;
  target_segment?: unknown;
  bot_id?: string | null;
  ab_variants?: unknown | null;
  message_template?: string | null;
  trigger_type?: 'manual' | 'scheduled' | 'event';
  scheduled_at?: string | null;
  trigger_config?: unknown | null;
}

export interface UpdateCampaignInput {
  id: string;
  status?: string;
  name?: string;
  type?: string;
  target_segment?: unknown;
  bot_id?: string | null;
  ab_variants?: unknown | null;
  message_template?: string | null;
  trigger_type?: 'manual' | 'scheduled' | 'event';
  scheduled_at?: string | null;
  trigger_config?: unknown | null;
}

export interface MarketingLogsRow {
  campaign_id: string;
  replied?: boolean;
  converted?: boolean;
}

export class MarketingRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: { status?: string | null; type?: string | null } = {}): Promise<MarketingCampaignRow[]> {
    if (isDemoMode()) {
      let campaigns = _demoCampaigns;
      if (filters.status) campaigns = campaigns.filter(c => c.status === filters.status);
      if (filters.type) campaigns = campaigns.filter(c => c.type === filters.type);
      return campaigns;
    }

    try {
      let query = this.client
        .from('marketing_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.status) query = query.eq('status', filters.status);
      if (filters.type) query = query.eq('type', filters.type);

      const { data, error } = await query;
      if (error) throw new RepositoryError('list marketing campaigns', error.message, error.code);
      return (data ?? []) as MarketingCampaignRow[];
    } catch (error) {
      console.error('Database query failed for list marketing campaigns, falling back to demo data:', error);
      let campaigns = _demoCampaigns;
      if (filters.status) campaigns = campaigns.filter(c => c.status === filters.status);
      if (filters.type) campaigns = campaigns.filter(c => c.type === filters.type);
      return campaigns;
    }
  }

  async findById(id: string): Promise<MarketingCampaignRow | null> {
    if (isDemoMode()) {
      return _demoCampaigns.find(c => c.id === id) || null;
    }

    const { data, error } = await this.client
      .from('marketing_campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError('find marketing campaign', error.message, error.code);
    return data as MarketingCampaignRow | null;
  }

  async create(input: CreateCampaignInput): Promise<MarketingCampaignRow> {
    if (isDemoMode()) {
      const newCampaign: MarketingCampaignRow = {
        id: `demo-campaign-${Date.now()}`,
        name: input.name,
        type: input.type,
        target_segment: input.target_segment ?? {},
        bot_id: input.bot_id ?? null,
        status: input.trigger_type === 'scheduled' ? 'scheduled' : 'draft',
        ab_variants: input.ab_variants ?? null,
        message_template: input.message_template ?? null,
        trigger_type: input.trigger_type ?? 'manual',
        scheduled_at: input.scheduled_at ?? null,
        trigger_config: input.trigger_config ?? null,
        created_at: new Date().toISOString(),
      };
      _demoCampaigns.push(newCampaign);
      trimDemoArray(_demoCampaigns);
      return newCampaign;
    }

    const { data, error } = await this.client
      .from('marketing_campaigns')
      .insert({
        name: input.name,
        type: input.type,
        target_segment: input.target_segment ?? {},
        bot_id: input.bot_id ?? null,
        status: input.trigger_type === 'scheduled' ? 'scheduled' : 'draft',
        ab_variants: input.ab_variants ?? null,
        message_template: input.message_template ?? null,
        trigger_type: input.trigger_type ?? 'manual',
        scheduled_at: input.scheduled_at ?? null,
        trigger_config: input.trigger_config ?? null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create marketing campaign', error.message, error.code);
    return data as MarketingCampaignRow;
  }

  async update(input: UpdateCampaignInput): Promise<MarketingCampaignRow> {
    if (isDemoMode()) {
      const campaign = _demoCampaigns.find(c => c.id === input.id);
      if (!campaign) throw new RepositoryError('update marketing campaign', 'Campaign not found');
      if (input.status) campaign.status = input.status;
      if (input.name) campaign.name = input.name;
      if (input.type) campaign.type = input.type;
      if (input.target_segment !== undefined) (campaign as unknown as Record<string, unknown>).target_segment = input.target_segment;
      if (input.ab_variants !== undefined) (campaign as unknown as Record<string, unknown>).ab_variants = input.ab_variants;
      if (input.message_template !== undefined) (campaign as unknown as Record<string, unknown>).message_template = input.message_template;
      if (input.trigger_type !== undefined) (campaign as unknown as Record<string, unknown>).trigger_type = input.trigger_type;
      if (input.scheduled_at !== undefined) (campaign as unknown as Record<string, unknown>).scheduled_at = input.scheduled_at;
      return campaign;
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.status !== undefined) updateData.status = input.status;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.type !== undefined) updateData.type = input.type;
    if (input.target_segment !== undefined) updateData.target_segment = input.target_segment;
    if (input.bot_id !== undefined) updateData.bot_id = input.bot_id;
    if (input.ab_variants !== undefined) updateData.ab_variants = input.ab_variants;
    if (input.message_template !== undefined) updateData.message_template = input.message_template;
    if (input.trigger_type !== undefined) updateData.trigger_type = input.trigger_type;
    if (input.scheduled_at !== undefined) updateData.scheduled_at = input.scheduled_at;
    if (input.trigger_config !== undefined) updateData.trigger_config = input.trigger_config;

    const { data, error } = await this.client
      .from('marketing_campaigns')
      .update(updateData)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update marketing campaign', error.message, error.code);
    return data as MarketingCampaignRow;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      const idx = _demoCampaigns.findIndex(c => c.id === id);
      if (idx !== -1) _demoCampaigns.splice(idx, 1);
      return;
    }

    const { error } = await this.client.from('marketing_campaigns').delete().eq('id', id);
    if (error) throw new RepositoryError('delete marketing campaign', error.message, error.code);
  }

  async countLogsByCampaign(campaignId: string): Promise<{ sent: number; replied: number; converted: number }> {
    if (isDemoMode()) {
      return { sent: Math.floor(Math.random() * 1000) + 100, replied: Math.floor(Math.random() * 500) + 50, converted: Math.floor(Math.random() * 100) + 10 };
    }

    const [{ count: sent }, { count: replied }, { count: converted }] = await Promise.all([
      this.client.from('marketing_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', campaignId),
      this.client.from('marketing_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('replied', true),
      this.client.from('marketing_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('converted', true),
    ]);

    return {
      sent: sent ?? 0,
      replied: replied ?? 0,
      converted: converted ?? 0,
    };
  }

  async countAllLogs(): Promise<{ totalSent: number; totalReplied: number; totalConverted: number }> {
    if (isDemoMode()) {
      return { totalSent: 5000, totalReplied: 1200, totalConverted: 320 };
    }

    try {
      const [{ count: totalSent }, { count: totalReplied }, { count: totalConverted }] = await Promise.all([
        this.client.from('marketing_logs').select('*', { count: 'exact', head: true }),
        this.client.from('marketing_logs').select('*', { count: 'exact', head: true }).eq('replied', true),
        this.client.from('marketing_logs').select('*', { count: 'exact', head: true }).eq('converted', true),
      ]);

      return {
        totalSent: totalSent ?? 0,
        totalReplied: totalReplied ?? 0,
        totalConverted: totalConverted ?? 0,
      };
    } catch (error) {
      console.error('Database query failed for countAllLogs, returning fallback:', error);
      return { totalSent: 0, totalReplied: 0, totalConverted: 0 };
    }
  }

  /**
   * Find customers matching a target segment
   * target_segment is a JSON object with filters like { platform: 'taobao', tag: 'VIP', member_level: 'gold' }
   */
  async findCustomersBySegment(targetSegment: Record<string, unknown>): Promise<Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }>> {
    if (isDemoMode()) {
      return [
        { id: 'demo-cust-1', name: '刘思思', source_platform: 'taobao', tags: ['VIP', '高频'] },
        { id: 'demo-cust-2', name: '陈大伟', source_platform: 'jd', tags: ['退换货'] },
      ];
    }

    try {
      let query = this.client
        .from('customers')
        .select('id, name, source_platform, tags');

      // Apply segment filters
      if (targetSegment.platform) {
        query = query.eq('source_platform', String(targetSegment.platform));
      }
      if (targetSegment.tag) {
        query = query.contains('tags', [String(targetSegment.tag)]);
      }
      if (targetSegment.member_level) {
        query = query.contains('metadata', { member_level: String(targetSegment.member_level) });
      }
      if (targetSegment.exclude_anonymous) {
        query = query.eq('is_anonymous', false);
      }

      // Silence filter: last_seen_at more than N days ago
      if (targetSegment.inactive_days) {
        const days = Number(targetSegment.inactive_days);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        query = query.lt('last_seen_at', cutoff.toISOString());
      }

      // New customer filter: first_seen_at within N days
      if (targetSegment.new_customer_days) {
        const days = Number(targetSegment.new_customer_days);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        query = query.gt('first_seen_at', cutoff.toISOString());
      }

      // Conversation count range
      if (targetSegment.min_conversations !== undefined) {
        query = query.gte('conversation_count', Number(targetSegment.min_conversations));
      }
      if (targetSegment.max_conversations !== undefined) {
        query = query.lte('conversation_count', Number(targetSegment.max_conversations));
      }

      // Limit to 500 customers per campaign execution to avoid overwhelming the system
      const { data, error } = await query.limit(500);
      if (error) throw new RepositoryError('find customers by segment', error.message, error.code);
      return (data ?? []) as Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }>;
    } catch (error) {
      console.error('Database query failed for findCustomersBySegment:', error);
      return [];
    }
  }

  /**
   * Preview how many customers match a given segment (lightweight count + sample list)
   */
  async previewSegment(
    targetSegment: Record<string, unknown>,
    limit = 10
  ): Promise<{ total: number; samples: Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }> }> {
    if (isDemoMode()) {
      const samples = [
        { id: 'demo-cust-1', name: '刘思思', source_platform: 'taobao', tags: ['VIP'] },
        { id: 'demo-cust-2', name: '陈大伟', source_platform: 'jd', tags: ['退换货'] },
      ];
      return { total: 2, samples };
    }

    try {
      let countQuery = this.client.from('customers').select('*', { count: 'exact', head: true });
      let sampleQuery = this.client.from('customers').select('id, name, source_platform, tags').limit(limit);

      if (targetSegment.platform) {
        countQuery = countQuery.eq('source_platform', String(targetSegment.platform));
        sampleQuery = sampleQuery.eq('source_platform', String(targetSegment.platform));
      }
      if (targetSegment.tag) {
        countQuery = countQuery.contains('tags', [String(targetSegment.tag)]);
        sampleQuery = sampleQuery.contains('tags', [String(targetSegment.tag)]);
      }
      if (targetSegment.member_level) {
        countQuery = countQuery.contains('metadata', { member_level: String(targetSegment.member_level) });
        sampleQuery = sampleQuery.contains('metadata', { member_level: String(targetSegment.member_level) });
      }
      if (targetSegment.exclude_anonymous) {
        countQuery = countQuery.eq('is_anonymous', false);
        sampleQuery = sampleQuery.eq('is_anonymous', false);
      }
      if (targetSegment.inactive_days) {
        const days = Number(targetSegment.inactive_days);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        countQuery = countQuery.lt('last_seen_at', cutoff.toISOString());
        sampleQuery = sampleQuery.lt('last_seen_at', cutoff.toISOString());
      }
      if (targetSegment.new_customer_days) {
        const days = Number(targetSegment.new_customer_days);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        countQuery = countQuery.gt('first_seen_at', cutoff.toISOString());
        sampleQuery = sampleQuery.gt('first_seen_at', cutoff.toISOString());
      }
      if (targetSegment.min_conversations !== undefined) {
        countQuery = countQuery.gte('conversation_count', Number(targetSegment.min_conversations));
        sampleQuery = sampleQuery.gte('conversation_count', Number(targetSegment.min_conversations));
      }
      if (targetSegment.max_conversations !== undefined) {
        countQuery = countQuery.lte('conversation_count', Number(targetSegment.max_conversations));
        sampleQuery = sampleQuery.lte('conversation_count', Number(targetSegment.max_conversations));
      }

      const [countResult, sampleResult] = await Promise.all([
        countQuery,
        sampleQuery,
      ]);

      const total = countResult.count ?? 0;
      const samples = (sampleResult.data ?? []) as Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }>;
      return { total, samples };
    } catch (error) {
      console.error('Database query failed for previewSegment:', error);
      return { total: 0, samples: [] };
    }
  }

  /**
   * Create a marketing log entry for a campaign touch
   */
  async createMarketingLog(input: {
    campaign_id: string;
    customer_id: string;
    variant?: string;
    conversation_id?: string;
  }): Promise<{ id: string }> {
    if (isDemoMode()) {
      return { id: `demo-mlog-${Date.now()}` };
    }

    const { data, error } = await this.client
      .from('marketing_logs')
      .insert({
        campaign_id: input.campaign_id,
        customer_id: input.customer_id,
        variant: input.variant || null,
        conversation_id: input.conversation_id || null,
        sent_at: new Date().toISOString(),
        opened: false,
        replied: false,
        converted: false,
      })
      .select('id')
      .single();

    if (error) throw new RepositoryError('create marketing log', error.message, error.code);
    return { id: data.id };
  }

  /**
   * Get daily marketing stats for a date range
   */
  async getDailyStats(
    campaignId?: string,
    days = 30
  ): Promise<Array<{ date: string; sent: number; replied: number; converted: number }>> {
    if (isDemoMode()) {
      const result = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        result.push({
          date: d.toISOString().split('T')[0],
          sent: Math.floor(Math.random() * 20),
          replied: Math.floor(Math.random() * 8),
          converted: Math.floor(Math.random() * 3),
        });
      }
      return result;
    }

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      let query = this.client
        .from('marketing_logs')
        .select('sent_at, replied, converted')
        .gte('sent_at', startDate.toISOString());

      if (campaignId) {
        query = query.eq('campaign_id', campaignId);
      }

      const { data, error } = await query;
      if (error) throw new RepositoryError('getDailyStats', error.message, error.code);

      const byDate: Record<string, { sent: number; replied: number; converted: number }> = {};
      for (const log of data ?? []) {
        const date = (log.sent_at as string).split('T')[0];
        if (!byDate[date]) byDate[date] = { sent: 0, replied: 0, converted: 0 };
        byDate[date].sent++;
        if (log.replied) byDate[date].replied++;
        if (log.converted) byDate[date].converted++;
      }

      const result = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const existing = byDate[dateStr];
        result.push({ date: dateStr, sent: existing?.sent ?? 0, replied: existing?.replied ?? 0, converted: existing?.converted ?? 0 });
      }
      return result;
    } catch (error) {
      console.error('getDailyStats failed:', error);
      return [];
    }
  }

  /**
   * Get A/B variant comparison for a campaign
   */
  async getVariantStats(campaignId: string): Promise<Array<{
    variant: string;
    sent: number;
    replied: number;
    converted: number;
    reply_rate: string;
    conversion_rate: string;
  }>> {
    if (isDemoMode()) {
      return [
        { variant: 'A', sent: 50, replied: 20, converted: 6, reply_rate: '40.0', conversion_rate: '12.0' },
        { variant: 'B', sent: 50, replied: 15, converted: 4, reply_rate: '30.0', conversion_rate: '8.0' },
      ];
    }

    try {
      const { data, error } = await this.client
        .from('marketing_logs')
        .select('variant, replied, converted')
        .eq('campaign_id', campaignId)
        .not('variant', 'is', null);

      if (error) throw new RepositoryError('getVariantStats', error.message, error.code);

      const byVariant: Record<string, { sent: number; replied: number; converted: number }> = {};
      for (const log of data ?? []) {
        const v = log.variant ?? 'A';
        if (!byVariant[v]) byVariant[v] = { sent: 0, replied: 0, converted: 0 };
        byVariant[v].sent++;
        if (log.replied) byVariant[v].replied++;
        if (log.converted) byVariant[v].converted++;
      }

      return Object.entries(byVariant).map(([variant, stats]) => ({
        variant,
        sent: stats.sent,
        replied: stats.replied,
        converted: stats.converted,
        reply_rate: stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : '0.0',
        conversion_rate: stats.sent > 0 ? ((stats.converted / stats.sent) * 100).toFixed(1) : '0.0',
      }));
    } catch (error) {
      console.error('getVariantStats failed:', error);
      return [];
    }
  }

  /**
   * Get campaign stats grouped by type
   */
  async getStatsByType(): Promise<Record<string, { sent: number; replied: number; converted: number }>> {
    if (isDemoMode()) {
      return {
        abandoned_cart: { sent: 80, replied: 30, converted: 8 },
        promotion: { sent: 120, replied: 45, converted: 15 },
        win_back: { sent: 40, replied: 10, converted: 2 },
      };
    }

    try {
      const { data, error } = await this.client
        .from('marketing_logs')
        .select('replied, converted, campaign:marketing_campaigns(type)');

      if (error) throw new RepositoryError('getStatsByType', error.message, error.code);

      const byType: Record<string, { sent: number; replied: number; converted: number }> = {};
      for (const log of data ?? []) {
        const campaign = log.campaign as { type?: string } | null;
        const type = campaign?.type ?? 'unknown';
        if (!byType[type]) byType[type] = { sent: 0, replied: 0, converted: 0 };
        byType[type].sent++;
        if (log.replied) byType[type].replied++;
        if (log.converted) byType[type].converted++;
      }
      return byType;
    } catch (error) {
      console.error('getStatsByType failed:', error);
      return {};
    }
  }

  /**
   * Get top performing campaigns
   */
  async getTopCampaigns(limit = 5): Promise<Array<{
    id: string;
    name: string;
    type: string;
    sent: number;
    replied: number;
    converted: number;
    reply_rate: string;
  }>> {
    if (isDemoMode()) {
      return [
        { id: '1', name: '618大促', type: 'promotion', sent: 120, replied: 45, converted: 15, reply_rate: '37.5' },
        { id: '2', name: '新客首购', type: 'abandoned_cart', sent: 80, replied: 30, converted: 8, reply_rate: '37.5' },
      ];
    }

    try {
      const { data: campaigns, error: campErr } = await this.client
        .from('marketing_campaigns')
        .select('id, name, type')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (campErr) throw new RepositoryError('getTopCampaigns', campErr.message, campErr.code);

      const results = [];
      for (const camp of campaigns ?? []) {
        const stats = await this.countLogsByCampaign(camp.id);
        results.push({
          ...camp,
          ...stats,
          reply_rate: stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : '0.0',
        });
      }
      return results;
    } catch (error) {
      console.error('getTopCampaigns failed:', error);
      return [];
    }
  }

}