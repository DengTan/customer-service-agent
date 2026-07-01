import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import { getAuthenticatedUserId, extractUserRole } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * Check if user has permission to access a simulation conversation
 * - Admin can access all
 * - Creator (created_by) can access their own
 * - null created_by (legacy) only accessible by admin
 */
function canAccessConversation(
  simulation: { created_by?: string | null },
  userId: string | null,
  role: string | null
): boolean {
  if (role === 'admin') return true;
  if (!userId) return false;
  if (simulation.created_by === null || simulation.created_by === undefined) {
    return false;
  }
  return simulation.created_by === userId;
}

function escapeCsvValue(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// GET /api/simulations/[id]/export - Export simulation details and messages
export const GET = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: simulationId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';

    const userId = getAuthenticatedUserId(request);
    const role = extractUserRole(request);

    const simulation = await simulationRepository.getById(simulationId);

    if (!simulation) {
      return NextResponse.json({ error: '模拟会话不存在' }, { status: 404 });
    }

    if (!canAccessConversation(simulation, userId, role)) {
      return NextResponse.json({ error: '无权限查看此会话' }, { status: 403 });
    }

    const messages = await simulationRepository.listMessages(simulationId);

    const exportData = {
      conversation: {
        id: simulation.id,
        title: simulation.title,
        scenario_id: simulation.scenario_id,
        scenario_name: simulation.scenario_name,
        status: simulation.status,
        message_count: simulation.message_count,
        created_at: simulation.created_at,
        updated_at: simulation.updated_at,
      },
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        sources: msg.sources,
        confidence: msg.confidence,
        confidence_breakdown: msg.confidence_breakdown,
        tool_calls: msg.tool_calls,
        created_at: msg.created_at,
      })),
      metadata: {
        exported_at: new Date().toISOString(),
        total_messages: messages.length,
      },
    };

    if (format === 'csv') {
      const csvHeaders = [
        '消息ID',
        '角色',
        '内容',
        '置信度',
        '知识库来源',
        '工具调用',
        '创建时间',
      ];

      const csvRows = messages.map((msg) =>
        [
          escapeCsvValue(msg.id),
          escapeCsvValue(msg.role),
          escapeCsvValue(msg.content),
          escapeCsvValue(msg.confidence ?? ''),
          escapeCsvValue(
            Array.isArray(msg.sources)
              ? msg.sources.map((s) => (s as { title?: string }).title).filter(Boolean).join('; ')
              : ''
          ),
          escapeCsvValue(
            Array.isArray(msg.tool_calls)
              ? msg.tool_calls.map((t) => (t as { name?: string }).name).filter(Boolean).join('; ')
              : ''
          ),
          escapeCsvValue(msg.created_at),
        ].join(',')
      );

      const csvContent = [
        `# 模拟会话导出`,
        `# 会话ID: ${simulation.id}`,
        `# 标题: ${simulation.title}`,
        `# 场景: ${simulation.scenario_name || simulation.scenario_id || '未知'}`,
        `# 消息数: ${messages.length}`,
        `# 导出时间: ${exportData.metadata.exported_at}`,
        '',
        csvHeaders.join(','),
        ...csvRows,
      ].join('\n');

      const filename = `simulation-${simulation.scenario_id || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(exportData);
  } catch (error) {
    logger.api.error('[Simulation Export] Error', { error, simulationId });
    return NextResponse.json({ error: '导出失败' }, { status: 500 });
  }
};
