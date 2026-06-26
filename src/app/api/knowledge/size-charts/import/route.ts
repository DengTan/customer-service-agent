import { NextRequest, NextResponse } from 'next/server';
import { SizeChartService } from '@/server/services/size-chart-service';
import { checkRateLimit } from '@/lib/api-utils';
import * as XLSX from 'xlsx';

const service = new SizeChartService();

interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export async function POST(request: NextRequest) {
  const rateLimitError = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
      return NextResponse.json({ error: '只支持 .xlsx、.xls、.csv 格式' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: '文件大小不能超过 5MB' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      return NextResponse.json({ error: '文件格式错误，无法解析' }, { status: 400 });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

    if (data.length === 0) {
      return NextResponse.json({ error: '文件中没有数据' }, { status: 400 });
    }

    const firstRow = data[0];
    if (!('尺码表名称' in firstRow)) {
      return NextResponse.json({ error: '文件必须包含「尺码表名称」列' }, { status: 400 });
    }

    const result: ImportResult = { success: 0, failed: 0, skipped: 0, errors: [] };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;

      const name = String(row['尺码表名称'] || '').trim();
      if (!name) {
        result.failed++;
        result.errors.push({ row: rowNum, message: '尺码表名称不能为空' });
        continue;
      }

      // Parse chart_type
      const chartTypeRaw = String(row['类型'] || 'custom').trim().toLowerCase();
      const chartTypeMap: Record<string, string> = {
        '服装': 'clothing', 'clothing': 'clothing',
        '鞋类': 'shoes', 'shoes': 'shoes',
        '配饰': 'accessories', 'accessories': 'accessories',
        '自定义': 'custom', 'custom': 'custom',
      };
      const chart_type = chartTypeMap[chartTypeRaw] || 'custom';

      // Parse columns and rows from JSON strings or comma-separated values
      const sizeColumnsRaw = String(row['尺码列定义'] || '').trim();
      const sizeRowsRaw = String(row['尺码数据'] || '').trim();

      let sizeColumns: Array<{ key: string; label: string }> = [];
      let sizeRows: Array<Record<string, string>> = [];

      // Try JSON parse first
      try {
        if (sizeColumnsRaw) sizeColumns = JSON.parse(sizeColumnsRaw);
      } catch {
        // Fallback: comma-separated column keys "size,胸围,腰围" -> [{key:"size",label:"尺码"},...]
        if (sizeColumnsRaw) {
          sizeColumns = sizeColumnsRaw.split(',').map(key => ({
            key: key.trim(),
            label: key.trim(),
          }));
        }
      }

      try {
        if (sizeRowsRaw) sizeRows = JSON.parse(sizeRowsRaw);
      } catch {
        // If not JSON, try to parse as multi-line text (each line: "S,82-86,62-66")
        if (sizeRowsRaw) {
          const lines = sizeRowsRaw.split('\n').filter(l => l.trim());
          const colKeys = sizeColumns.map(c => c.key);
          sizeRows = lines.map(line => {
            const vals = line.split(',').map(v => v.trim());
            const rowObj: Record<string, string> = {};
            colKeys.forEach((k, idx) => { rowObj[k] = vals[idx] || ''; });
            return rowObj;
          });
        }
      }

      // Parse recommend_enabled
      const recommendEnabledRaw = String(row['启用推荐'] || '').trim().toLowerCase();
      const recommend_enabled = ['是', 'true', '1', 'yes'].includes(recommendEnabledRaw);
      const recommend_params = recommend_enabled ? { dimensions: [], enabled: true } : undefined;

      const recommendRules = String(row['推荐规则'] || '').trim();
      const description = String(row['补充说明'] || '').trim();
      const category = String(row['分类'] || '').trim();
      const sku = String(row['关联SKU'] || '').trim();

      const existing = await service.listSizeCharts({ search: name }, { page: 1, pageSize: 1 });
      if (existing.items.length > 0) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: `尺码表「${name}」已存在，跳过` });
        continue;
      }

      try {
        await service.createSizeChart({
          name,
          chart_type,
          category,
          sku: sku || undefined,
          size_columns: sizeColumns,
          size_rows: sizeRows,
          recommend_params,
          recommend_rules: recommendRules || undefined,
          description: description || undefined,
        });
        result.success++;
      } catch (err) {
        result.failed++;
        result.errors.push({ row: rowNum, message: `创建失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
