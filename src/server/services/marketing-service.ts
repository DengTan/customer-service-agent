import {
  MarketingRepository,
  type MarketingCampaignRow,
  type CampaignWithStats,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '@/server/repositories/marketing-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

export interface MarketingOverallStats {
  total_sent: number;
  total_replied: number;
  total_converted: number;
  reply_rate: string;
}

export class MarketingService {
  constructor(private readonly repo = new MarketingRepository()) {}

  async listCampaigns(filters: { status?: string | null; type?: string | null } = {}): Promise<{
    campaigns: CampaignWithStats[];
    overall_stats: MarketingOverallStats;
  }> {
    try {
      const [campaigns, overallCounts] = await Promise.all([
        this.repo.list(filters),
        this.repo.countAllLogs(),
      ]);

      const campaignsWithStats = await Promise.all(
        campaigns.map(async (campaign) => {
          const stats = await this.repo.countLogsByCampaign(campaign.id);
          return { ...campaign, stats } as CampaignWithStats;
        }),
      );

      const overallStats: MarketingOverallStats = {
        total_sent: overallCounts.totalSent,
        total_replied: overallCounts.totalReplied,
        total_converted: overallCounts.totalConverted,
        reply_rate: overallCounts.totalSent
          ? ((overallCounts.totalReplied / overallCounts.totalSent) * 100).toFixed(1)
          : '0.0',
      };

      return { campaigns: campaignsWithStats, overall_stats: overallStats };
    } catch (error) {
      throw toServiceError(error, '获取营销活动列表失败', 'DB_ERROR');
    }
  }

  async createCampaign(input: CreateCampaignInput): Promise<{ campaign: MarketingCampaignRow }> {
    if (!input.name || !input.type) {
      throw new ServiceError('名称和类型为必填项', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const campaign = await this.repo.create(input);
      return { campaign };
    } catch (error) {
      throw toServiceError(error, '创建营销活动失败', 'DB_ERROR');
    }
  }

  async updateCampaign(input: UpdateCampaignInput): Promise<{ campaign: MarketingCampaignRow }> {
    if (!input.id) {
      throw new ServiceError('缺少活动ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const campaign = await this.repo.update(input);
      return { campaign };
    } catch (error) {
      throw toServiceError(error, '更新营销活动失败', 'DB_ERROR');
    }
  }

  async deleteCampaign(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少活动ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除营销活动失败', 'DB_ERROR');
    }
  }

  /**
   * Preview how many customers match a given segment
   */
  async previewSegment(targetSegment: Record<string, unknown>): Promise<{
    total: number;
    samples: Array<{ id: string; name: string; source_platform: string | null; tags: string[] | null }>;
  }> {
    try {
      return await this.repo.previewSegment(targetSegment);
    } catch (error) {
      throw toServiceError(error, '客群预览失败', 'DB_ERROR');
    }
  }

  /**
   * Execute a marketing campaign: find matching customers, create conversations, and send messages
   * Returns a summary of the execution
   */
  async executeCampaign(campaignId: string): Promise<{
    campaignId: string;
    campaignName: string;
    totalTargeted: number;
    successCount: number;
    failCount: number;
    details: Array<{ customerId: string; customerName: string; status: 'sent' | 'failed'; error?: string }>;
  }> {
    // 1. Find the campaign
    const campaign = await this.repo.findById(campaignId);
    if (!campaign) {
      throw new ServiceError('活动不存在', { status: 404, code: 'NOT_FOUND' });
    }

    if (campaign.status !== 'active') {
      throw new ServiceError('只能执行状态为"进行中"的活动', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // 2. Find matching customers by target segment
    const targetSegment = (campaign.target_segment as Record<string, unknown>) || {};
    const customers = await this.repo.findCustomersBySegment(targetSegment);

    if (customers.length === 0) {
      return {
        campaignId,
        campaignName: campaign.name,
        totalTargeted: 0,
        successCount: 0,
        failCount: 0,
        details: [],
      };
    }

    // 3. For each customer, create a conversation and send the campaign message
    const details: Array<{ customerId: string; customerName: string; status: 'sent' | 'failed'; error?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    // Template variable interpolation
    const renderTemplate = (template: string, vars: Record<string, string>): string => {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
    };

    // Default templates by type (fallback when no custom template)
    const defaultTemplates: Record<string, string> = {
      abandoned_cart: `{{customer_name}}，您购物车中的商品即将售罄，抓紧时间下单吧！如有疑问，欢迎咨询。`,
      browsing_nurture: `{{customer_name}}，您浏览的商品有新优惠，快来看看吧！如有需要，随时联系我们。`,
      win_back: `{{customer_name}}，好久不见！我们为您准备了专属回归礼，欢迎回来看看。`,
      promotion: `{{customer_name}}，{{campaign_name}}火热进行中，限时优惠不要错过！欢迎咨询详情。`,
      announcement: `{{customer_name}}，{{campaign_name}}，特此通知。如有疑问，欢迎咨询。`,
      loyalty: `尊敬的{{customer_name}}，{{campaign_name}}已开启，感谢您的支持！如有需要，欢迎咨询。`,
    };

    // Use campaign's custom template, or fall back to type default
    const baseTemplate = (campaign.message_template as string | null) || defaultTemplates[campaign.type] || `您好！{{campaign_name}}，欢迎咨询详情。`;

    // Determine A/B variant
    const variants = campaign.ab_variants as Record<string, string> | null;
    const variantKeys = variants ? Object.keys(variants) : [];
    const getVariant = (index: number): string | undefined => {
      if (variantKeys.length === 0) return undefined;
      return variantKeys[index % variantKeys.length];
    };

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      try {
        // Create a conversation for this customer
        const { ConversationService } = await import('./conversation-service');
        const conversationService = new ConversationService();
        const conversation = await conversationService.createConversation({
          title: `[营销] ${campaign.name} - ${customer.name}`,
          source: 'marketing',
        });

        // Insert the campaign message as the first message (with variable interpolation)
        const variant = getVariant(i);
        const variantTemplate = variant && variants?.[variant]
          ? variants[variant]
          : baseTemplate;

        const messageContent = renderTemplate(variantTemplate, {
          customer_name: customer.name,
          campaign_name: campaign.name,
          shop_name: '您选购的店铺', // shop_name requires shops table lookup, fallback here
        });

        await conversationService.insertMessage({
          conversation_id: conversation.id,
          role: 'assistant',
          content: messageContent,
          sources: [{ type: 'marketing_campaign', campaignId, campaignName: campaign.name, variant }],
        });

        // Create marketing log
        await this.repo.createMarketingLog({
          campaign_id: campaignId,
          customer_id: customer.id,
          variant,
          conversation_id: conversation.id,
        });

        details.push({ customerId: customer.id, customerName: customer.name, status: 'sent' });
        successCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[MarketingService] Failed to execute campaign for customer', { error: errorMsg, customerId: customer.id });
        details.push({ customerId: customer.id, customerName: customer.name, status: 'failed', error: errorMsg });
        failCount++;
      }
    }

    return {
      campaignId,
      campaignName: campaign.name,
      totalTargeted: customers.length,
      successCount,
      failCount,
      details,
    };
  }

  /**
   * Get comprehensive marketing analytics
   */
  async getAnalytics(campaignId?: string, days = 30): Promise<{
    overall: { total_sent: number; total_replied: number; total_converted: number; reply_rate: string };
    trend: Array<{ date: string; sent: number; replied: number; converted: number }>;
    by_type: Record<string, { sent: number; replied: number; converted: number }>;
    variant_comparison: Array<{ variant: string; sent: number; replied: number; converted: number; reply_rate: string; conversion_rate: string }>;
    top_campaigns: Array<{ id: string; name: string; type: string; sent: number; replied: number; converted: number; reply_rate: string }>;
  }> {
    try {
      const [overallCounts, trend, byType, topCampaigns] = await Promise.all([
        this.repo.countAllLogs(),
        this.repo.getDailyStats(campaignId, days),
        this.repo.getStatsByType(),
        this.repo.getTopCampaigns(5),
      ]);

      const variantComparison = campaignId
        ? await this.repo.getVariantStats(campaignId)
        : [];

      const overall = {
        total_sent: overallCounts.totalSent,
        total_replied: overallCounts.totalReplied,
        total_converted: overallCounts.totalConverted,
        reply_rate: overallCounts.totalSent > 0
          ? ((overallCounts.totalReplied / overallCounts.totalSent) * 100).toFixed(1)
          : '0.0',
      };

      return { overall, trend, by_type: byType, variant_comparison: variantComparison, top_campaigns: topCampaigns };
    } catch (error) {
      throw toServiceError(error, '获取营销分析数据失败', 'DB_ERROR');
    }
  }


  /**
   * Determine A/B test winner for a campaign
   * Returns null if no significant difference or insufficient sample
   */
  async determineABWinner(campaignId: string): Promise<{
    winner: 'A' | 'B' | null;
    confidence: number;
    reason: string;
    stats_a: { sent: number; replied: number; converted: number; reply_rate: string; conversion_rate: string };
    stats_b: { sent: number; replied: number; converted: number; reply_rate: string; conversion_rate: string };
  }> {
    try {
      const variants = await this.repo.getVariantStats(campaignId);
      const statA = variants.find(v => v.variant === 'A');
      const statB = variants.find(v => v.variant === 'B');

      if (!statA || !statB) {
        return { winner: null, confidence: 0, reason: '数据不足', stats_a: statA!, stats_b: statB! };
      }

      // Minimum sample size check
      if (statA.sent < 30 || statB.sent < 30) {
        return { winner: null, confidence: 0, reason: '样本量不足（每组至少30条）', stats_a: statA, stats_b: statB };
      }

      const rateA = parseFloat(statA.reply_rate);
      const rateB = parseFloat(statB.reply_rate);
      const diff = Math.abs(rateA - rateB);

      // No significant difference (< 5%)
      if (diff < 5) {
        return { winner: null, confidence: 0, reason: '无显著差异（差值 < 5%）', stats_a: statA, stats_b: statB };
      }

      const winner = rateA > rateB ? 'A' : 'B';
      const winnerRate = Math.max(rateA, rateB);
      const loserRate = Math.min(rateA, rateB);
      const confidence = Math.min(95, Math.round((diff / winnerRate) * 100));

      return {
        winner,
        confidence,
        reason: `变体${winner}领先${diff.toFixed(1)}个百分点`,
        stats_a: statA,
        stats_b: statB
      };
    } catch (error) {
      throw toServiceError(error, 'A/B测试判定失败', 'DB_ERROR');
    }
  }

  /**
   * Promote winner variant to all future sends
   */
  async promoteVariant(campaignId: string, winnerVariant: 'A' | 'B'): Promise<{ campaign: MarketingCampaignRow }> {
    try {
      const campaign = await this.repo.findById(campaignId);
      if (!campaign) throw new ServiceError('活动不存在', { status: 404, code: 'NOT_FOUND' });

      const variants = campaign.ab_variants as { enabled?: boolean; variant_a?: string; variant_b?: string } | null;
      if (!variants?.enabled) {
        throw new ServiceError('该活动未启用A/B测试', { status: 400, code: 'INVALID_STATE' });
      }

      // Read winning variant content
      const winnerTemplate = winnerVariant === 'A' ? variants.variant_a : variants.variant_b;

      // Disable A/B and set winner content as the single message template
      await this.repo.update({
        id: campaignId,
        ab_variants: { enabled: false, variant_a: winnerTemplate, variant_b: null },
        message_template: winnerTemplate ?? null,
      });

      const updated = await this.repo.findById(campaignId);
      return { campaign: updated! };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '推广获胜变体失败', 'DB_ERROR');
    }
  }


  /**
   * Process scheduled campaigns - call this on app startup or via cron
   * Finds all scheduled campaigns where scheduled_at <= now and status == "scheduled"
   * and executes them (changes status to "running" and sends messages)
   */
  async processScheduledCampaigns(): Promise<{ processed: number; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Find all scheduled campaigns ready to execute
      const scheduled = (await this.repo.list({})).filter(c =>
          c.status === 'scheduled' &&
          c.trigger_type === 'scheduled' &&
          c.scheduled_at &&
          new Date(c.scheduled_at) <= new Date()
        );

      let processed = 0;
      for (const campaign of scheduled) {
        try {
          // Update status to running first
          await this.repo.update({ id: campaign.id, status: 'running' });
          // Execute the campaign (same logic as executeCampaign but without starting status update)
          await this.executeCampaign(campaign.id);
          processed++;
        } catch (err) {
          errors.push(`活动 ${campaign.name} (${campaign.id}): ${err instanceof Error ? err.message : String(err)}`);
          // Mark as failed
          try {
            await this.repo.update({ id: campaign.id, status: 'failed' });
          } catch { /* ignore */ }
        }
      }
      return { processed, errors };
    } catch (err) {
      throw toServiceError(err, '处理定时任务失败', 'DB_ERROR');
    }
  }

}