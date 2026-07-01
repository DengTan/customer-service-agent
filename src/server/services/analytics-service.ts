import { AnalyticsRepository } from '@/server/repositories/analytics-repository';
import { toServiceError } from './service-utils';

export interface CoreMetrics {
  totalConversations: number;
  totalMessages: number;
  activeConversations: number;
  todayConversations: number;
  avgRating: number;
  avgMessagesPerConv: number;
  autoReplyHitRate: number;
  handoffCount: number;
}

export interface TrendDataPoint {
  date: string;
  count: number;
}

export interface MessageTrendDataPoint {
  date: string;
  user: number;
  assistant: number;
}

export interface RatingDistributionPoint {
  star: number;
  count: number;
}

export interface AlertStats {
  total: number;
  unresolved: number;
  critical: number;
  warning: number;
  info: number;
}

export interface RecentAlert {
  id: string;
  conversation_id: string;
  type: string;
  severity: string;
  message: string;
  is_resolved: boolean;
  created_at: string;
  conversations: { id: string; title: string; status: string } | null;
}

export interface SatisfactionTrendPoint {
  date: string;
  avgRating: number;
  count: number;
}

export interface SatisfactionBySourceEntry {
  avgRating: number;
  count: number;
}

export interface AnalyticsData {
  metrics: CoreMetrics;
  trendData: TrendDataPoint[];
  messageTrendData: MessageTrendDataPoint[];
  ratingDistribution: RatingDistributionPoint[];
  sourceDistribution: Record<string, number>;
  alertStats: AlertStats;
  recentAlerts: RecentAlert[];
  satisfactionTrend: SatisfactionTrendPoint[];
  satisfactionBySource: Record<string, SatisfactionBySourceEntry>;
}

export class AnalyticsService {
  constructor(private readonly repo = new AnalyticsRepository()) {}

  async getAnalytics(): Promise<AnalyticsData> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const [
        coreMetrics,
        recentConversations,
        sourceDistribution,
        recentMessages,
        autoReplyHits,
        alertStats,
        recentAlerts,
        handoffCount,
        ratingsWithDate,
        ratingsBySource,
      ] = await Promise.all([
        this.repo.getCoreMetrics(),
        this.repo.getRecentConversations(sevenDaysAgo.toISOString()),
        this.repo.getSourceDistribution(),
        this.repo.getRecentMessages(sevenDaysAgo.toISOString()),
        this.repo.getAutoReplyHits(),
        this.repo.getAlertStats(),
        this.repo.getRecentAlerts(),
        this.repo.getHandoffCount(),
        this.repo.getRatingsWithDate(sevenDaysAgo.toISOString()),
        this.repo.getRatingsBySource(),
      ]);

      const trendData = this.computeTrendData(recentConversations);
      const messageTrendData = this.computeMessageTrendData(recentMessages);
      const ratingDistribution = this.computeRatingDistribution(coreMetrics.ratings);
      const satisfactionTrend = this.computeSatisfactionTrend(ratingsWithDate);
      const satisfactionBySource = this.computeSatisfactionBySource(ratingsBySource);

      const totalMessages = coreMetrics.totalMessages;
      const avgMessagesPerConv =
        coreMetrics.totalConversations > 0
          ? Math.round((totalMessages / coreMetrics.totalConversations) * 10) / 10
          : 0;
      const autoReplyHitRate =
        totalMessages > 0 ? Math.round((autoReplyHits / totalMessages) * 1000) / 10 : 0;

      return {
        metrics: {
          totalConversations: coreMetrics.totalConversations,
          totalMessages,
          activeConversations: coreMetrics.activeConversations,
          todayConversations: coreMetrics.todayConversations,
          avgRating: Math.round(coreMetrics.avgRating * 10) / 10,
          avgMessagesPerConv,
          autoReplyHitRate,
          handoffCount,
        },
        trendData,
        messageTrendData,
        ratingDistribution,
        sourceDistribution,
        alertStats,
        recentAlerts: (recentAlerts || []) as RecentAlert[],
        satisfactionTrend,
        satisfactionBySource,
      };
    } catch (error) {
      throw toServiceError(error, '获取分析数据失败');
    }
  }

  private computeTrendData(
    recentConversations: Array<{ created_at: string }>,
  ): TrendDataPoint[] {
    const trendData: TrendDataPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const count =
        recentConversations.filter((c) => c.created_at.startsWith(dateStr)).length || 0;
      trendData.push({ date: dayLabel, count });
    }
    return trendData;
  }

  private computeMessageTrendData(
    recentMessages: Array<{ created_at: string; role: string }>,
  ): MessageTrendDataPoint[] {
    const messageTrendData: MessageTrendDataPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const dayMsgs = recentMessages.filter((m) => m.created_at.startsWith(dateStr));
      messageTrendData.push({
        date: dayLabel,
        user: dayMsgs.filter((m) => m.role === 'user').length,
        assistant: dayMsgs.filter((m) => m.role === 'assistant').length,
      });
    }
    return messageTrendData;
  }

  private computeRatingDistribution(
    ratings: Array<{ rating: number | null }>,
  ): RatingDistributionPoint[] {
    return [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: ratings.filter((r) => r.rating === star).length,
    }));
  }

  private computeSatisfactionTrend(
    ratingsWithDate: Array<{ rating: number | null; created_at: string }>,
  ): SatisfactionTrendPoint[] {
    const satisfactionTrend: SatisfactionTrendPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const dayRatings = ratingsWithDate.filter((r) => r.created_at.startsWith(dateStr));
      // Only include valid ratings (rating > 0), rating=0 is treated as invalid
      const validRatings = dayRatings.filter((r) => r.rating !== null && r.rating > 0);
      const dayAvg =
        validRatings.length > 0
          ? validRatings.reduce((sum, r) => sum + (r.rating || 0), 0) / validRatings.length
          : 0;
      satisfactionTrend.push({
        date: dayLabel,
        avgRating: Math.round(dayAvg * 10) / 10,
        count: validRatings.length,
      });
    }
    return satisfactionTrend;
  }

  private computeSatisfactionBySource(
    ratingsBySource: Array<{ rating: number | null; source: string | null }>,
  ): Record<string, SatisfactionBySourceEntry> {
    const satisfactionBySource: Record<string, SatisfactionBySourceEntry> = {};
    ratingsBySource.forEach((r) => {
      const source = r.source || 'web';
      if (!satisfactionBySource[source]) {
        satisfactionBySource[source] = { avgRating: 0, count: 0 };
      }
      // Only include valid ratings (rating > 0), rating=0 is treated as invalid
      if (r.rating !== null && r.rating > 0) {
        satisfactionBySource[source].count++;
        satisfactionBySource[source].avgRating += r.rating;
      }
    });
    Object.keys(satisfactionBySource).forEach((source) => {
      const entry = satisfactionBySource[source];
      entry.avgRating = entry.count > 0 
        ? Math.round((entry.avgRating / entry.count) * 10) / 10 
        : 0;
    });
    return satisfactionBySource;
  }
}
