/**
 * Size Chart Provider
 * Queries size charts from the size_charts table and generates size recommendations
 */

import { SizeChartService } from '../../services/size-chart-service';
import { NormalizedSizeChart, SizeChartRecommendDimension } from '../../repositories/size-chart-repository';
import { BaseToolProvider, ToolParams, ToolResult } from './types';

export class SizeChartProvider extends BaseToolProvider {
  readonly type = 'size_chart' as const;
  private service: SizeChartService;

  constructor() {
    super();
    this.service = new SizeChartService();
  }

  /**
   * Validate size chart query parameters
   */
  validate(params: ToolParams): { valid: boolean; errorMessage?: string; errorCode?: string } {
    const hasSku = params.sku && typeof params.sku === 'string' && (params.sku as string).trim().length > 0;
    const hasCategory = params.category && typeof params.category === 'string' && (params.category as string).trim().length > 0;
    const hasName = params.name && typeof params.name === 'string' && (params.name as string).trim().length > 0;
    const hasId = params.size_chart_id && typeof params.size_chart_id === 'string' && (params.size_chart_id as string).trim().length > 0;

    if (!hasSku && !hasCategory && !hasName && !hasId) {
      return {
        valid: false,
        errorMessage: '请提供商品SKU、尺码表分类、尺码表名称或尺码表ID',
        errorCode: 'MISSING_PARAMS',
      };
    }

    return { valid: true };
  }

  /**
   * Execute size chart query with optional recommendation
   */
  async execute(params: ToolParams): Promise<ToolResult> {
    const validation = this.validate(params);
    if (!validation.valid) {
      return {
        message: validation.errorMessage!,
        confidence: 0.3,
        isMockData: false,
        errorCode: validation.errorCode,
      };
    }

    try {
      let chart: NormalizedSizeChart | null = null;

      if (params.size_chart_id) {
        chart = await this.service.getSizeChart((params.size_chart_id as string).trim());
      } else if (params.sku) {
        // Use search which includes SKU in its match
        const results = await this.service.listSizeCharts(
          { search: (params.sku as string).trim() },
          { page: 1, pageSize: 1 },
        );
        chart = results.items[0] || null;
      } else if (params.name) {
        const results = await this.service.listSizeCharts(
          { search: (params.name as string).trim() },
          { page: 1, pageSize: 1 },
        );
        chart = results.items[0] || null;
      } else if (params.category) {
        const results = await this.service.listSizeCharts(
          { category: (params.category as string).trim() },
          { page: 1, pageSize: 1 },
        );
        chart = results.items[0] || null;
      }

      if (!chart) {
        return {
          message: '未找到该尺码表',
          confidence: 0.4,
          isMockData: false,
          errorCode: 'NOT_FOUND',
        };
      }

      // Build recommendation if dimensions provided
      let recommendation: { size: string; reason: string } | undefined;
      // recommend_enabled is true when recommend_params.dimensions has required dimensions
      if (chart.recommend_params?.dimensions?.length && chart.recommend_params.dimensions.length > 0) {
        const height = params.height as number | undefined;
        const weight = params.weight as number | undefined;
        if (height != null || weight != null) {
          recommendation = this.recommendSize(chart, height, weight);
        }
      }

      const message = this.formatSizeChartMessage(chart, recommendation);
      const data: Record<string, unknown> = {
        chart_id: chart.id,
        chart_name: chart.name,
        chart_type: chart.chart_type,
        category: chart.category,
        columns: chart.size_columns,
        rows: chart.size_rows,
        is_product_specific: !!chart.product_id,
        source_type: 'size_chart',
        ...(recommendation ? { recommendation } : {}),
      };

      // Confidence: found chart + has recommendation = higher
      const baseConfidence = chart.product_id ? 0.7 : 0.6;
      const confidence = recommendation ? 0.75 : baseConfidence;

      return {
        message,
        data,
        confidence,
        isMockData: false,
      };
    } catch (error) {
      console.error('[SizeChartProvider] Error querying size chart:', error);
      return {
        message: '查询尺码表信息失败',
        confidence: 0.3,
        isMockData: false,
        errorCode: 'QUERY_ERROR',
      };
    }
  }

  /**
   * Generate size recommendation based on customer measurements
   */
  private recommendSize(
    chart: NormalizedSizeChart,
    height?: number,
    weight?: number,
  ): { size: string; reason: string } | undefined {
    if (!chart.recommend_params?.dimensions || chart.size_rows.length === 0) {
      return undefined;
    }

    const dimensions = chart.recommend_params.dimensions;
    const heightDim = dimensions.find((d: SizeChartRecommendDimension) => d.key === 'height');
    const weightDim = dimensions.find((d: SizeChartRecommendDimension) => d.key === 'weight');

    // Try to find matching row based on height/weight
    for (const row of chart.size_rows) {
      let match = true;
      const reasons: string[] = [];

      if (height != null && heightDim) {
        const range = row[heightDim.key];
        if (range && typeof range === 'string') {
          const matchResult = this.matchRange(height, range);
          if (!matchResult.match) {
            match = false;
          } else {
            reasons.push(`身高${height}cm符合${range}范围`);
          }
        }
      }

      if (weight != null && weightDim) {
        const range = row[weightDim.key];
        if (range && typeof range === 'string') {
          const matchResult = this.matchRange(weight, range);
          if (!matchResult.match) {
            match = false;
          } else {
            reasons.push(`体重${weight}kg符合${range}范围`);
          }
        }
      }

      if (match) {
        const size = row['size'] || row['size_name'] || row['尺码'] || '未知';
        const reason = reasons.length > 0 ? reasons.join('，') : '符合尺码范围';
        return { size: String(size), reason };
      }
    }

    // No exact match - return the most inclusive size
    if (chart.size_rows.length > 0) {
      const lastRow = chart.size_rows[chart.size_rows.length - 1];
      const size = lastRow['size'] || lastRow['size_name'] || lastRow['尺码'] || 'M';
      const heightRange = heightDim ? lastRow[heightDim.key] : undefined;
      const weightRange = weightDim ? lastRow[weightDim.key] : undefined;
      let reason = '建议参考最大尺码';
      if (heightRange && weightRange) {
        reason = `身高${height ?? ''}cm体重${weight ?? ''}kg超出标准范围，建议选最大码`;
      } else if (heightRange) {
        reason = `身高${height ?? ''}cm超出标准范围，建议选最大码`;
      }
      return { size: String(size), reason };
    }

    return undefined;
  }

  /**
   * Check if a numeric value falls within a range string like "150-160" or "40-50kg"
   */
  private matchRange(value: number, range: string): { match: boolean; rangeNum?: [number, number] } {
    const cleaned = range.replace(/[a-zA-Z\u4e00-\u9fa5]/g, '').trim();
    const parts = cleaned.split('-');
    if (parts.length === 2) {
      const min = parseFloat(parts[0]);
      const max = parseFloat(parts[1]);
      if (!isNaN(min) && !isNaN(max)) {
        return { match: value >= min && value <= max, rangeNum: [min, max] };
      }
    }
    return { match: false };
  }

  /**
   * Format size chart info into human-readable message
   */
  private formatSizeChartMessage(chart: NormalizedSizeChart, recommendation?: { size: string; reason: string }): string {
    const parts: string[] = [`尺码表：${chart.name}`];

    if (chart.category) parts.push(`分类：${chart.category}`);
    parts.push(`类型：${this.getChartTypeLabel(chart.chart_type)}`);

    // Build table header
    const headers: string[] = chart.size_columns.map((col: { label: string }) => col.label);
    const headerLine = '|' + headers.map((h: string) => ` ${h} `).join('|') + '|';
    const dividerLine = '|' + headers.map(() => '---').join('|') + '|';

    // Build table rows
    const rowLines: string[] = [];
    for (const row of chart.size_rows) {
      const cells = chart.size_columns.map((col: { key: string }) => {
        const val = row[col.key] ?? '';
        return ` ${String(val)} `;
      });
      rowLines.push('|' + cells.join('|') + '|');
    }

    parts.push('\n' + [headerLine, dividerLine, ...rowLines].join('\n'));

    if (recommendation) {
      parts.push(`\n根据您提供的信息，推荐尺码：**${recommendation.size}**（${recommendation.reason}）`);
    }

    if (chart.description) {
      parts.push(`\n备注：${chart.description}`);
    }

    return parts.join('\n');
  }

  /**
   * Get human-readable label for chart type
   */
  private getChartTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      clothing: '服装',
      shoes: '鞋类',
      accessories: '配饰',
      custom: '自定义',
    };
    return labels[type] || type;
  }
}

let instance: SizeChartProvider | null = null;

export function getSizeChartProvider(): SizeChartProvider {
  if (!instance) {
    instance = new SizeChartProvider();
  }
  return instance;
}
