import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversation_id');
    const customerId = searchParams.get('customer_id');

    if (!conversationId && !customerId) {
      return NextResponse.json({ error: '请提供 conversation_id 或 customer_id' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    let query = supabase
      .from('tickets')
      .select('id, ticket_number, title, status, priority, category, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    } else if (customerId) {
      // Find tickets from conversations linked to this customer
      const { data: convLinks } = await supabase
        .from('customer_conversations')
        .select('conversation_id')
        .eq('customer_id', customerId);

      if (convLinks && convLinks.length > 0) {
        const convIds = convLinks.map(l => l.conversation_id);
        query = query.in('conversation_id', convIds);
      } else {
        return NextResponse.json({ tickets: [] });
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const STATUS_LABELS: Record<string, string> = {
      open: '待处理',
      in_progress: '处理中',
      pending_customer: '待您回复',
      resolved: '已解决',
      closed: '已关闭',
    };

    const tickets = (data || []).map(t => ({
      ...t,
      status_label: STATUS_LABELS[t.status] || t.status,
    }));

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('[Ticket Customer] GET error:', error);
    return NextResponse.json({ error: '查询工单失败' }, { status: 500 });
  }
}
