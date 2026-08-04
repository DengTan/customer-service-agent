import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getLogger } from '@/lib/logger';
import { TICKET } from '@/lib/constants';

const logger = getLogger('TicketsCustomer');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'read' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const conversationId = searchParams.get('conversation_id');
      const customerId = searchParams.get('customer_id');

      if (!conversationId && !customerId) {
        return new Response(JSON.stringify({ error: '请提供 conversation_id 或 customer_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const supabase = getSupabaseClient();

      let query = supabase
        .from('tickets')
        .select('id, ticket_number, title, status, priority, category, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(TICKET.CUSTOMER_TICKET_LIMIT);

      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      } else if (customerId) {
        const { data: convLinks } = await supabase
          .from('customer_conversations')
          .select('conversation_id')
          .eq('customer_id', customerId);

        if (convLinks && convLinks.length > 0) {
          const convIds = convLinks.map(l => l.conversation_id);
          query = query.in('conversation_id', convIds);
        } else {
          return new Response(JSON.stringify({ tickets: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
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

      return new Response(JSON.stringify({ tickets }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Customer] GET error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '查询工单失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
