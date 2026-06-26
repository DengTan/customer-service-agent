import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const priority = searchParams.get('priority');

    const supabase = getSupabaseClient();
    let query = supabase
      .from('tickets')
      .select('ticket_number, title, category, priority, status, assignee_id, creator_id, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (priority) query = query.eq('priority', priority);

    const { data, error } = await query;
    if (error) throw error;

    const tickets = data || [];

    // Generate CSV
    const headers = ['工单编号', '标题', '分类', '优先级', '状态', '负责人ID', '创建人ID', '创建时间', '更新时间'];
    const rows = tickets.map(t => [
      t.ticket_number,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      t.category,
      t.priority,
      t.status,
      t.assignee_id || '',
      t.creator_id || '',
      t.created_at,
      t.updated_at,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const BOM = '\uFEFF';

    return new NextResponse(BOM + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=tickets_${new Date().toISOString().split('T')[0]}.csv`,
      },
    });
  } catch (error) {
    console.error('[Export Tickets] error:', error);
    return NextResponse.json({ error: '导出失败' }, { status: 500 });
  }
}
