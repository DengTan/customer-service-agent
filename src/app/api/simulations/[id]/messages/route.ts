import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parseJsonBody, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { LLMStreamingService } from '@/server/services/llm-streaming-service';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import type { SimulationMessage } from '@/lib/types';
import { logger } from '@/lib/logger';

// Scenario-specific system prompts for simulation
const SCENARIO_PROMPTS: Record<string, string> = {
  order_inquiry: `你是订单咨询专员，专注于帮助用户查询订单状态、发货时间、物流进度等信息。请：
1. 主动提供订单状态信息
2. 解释发货和物流流程
3. 对延迟表示歉意并提供解决方案
4. 使用友好的客服口吻`,
  refund_request: `你是退款处理专员，负责处理用户的退款申请和退货流程。请：
1. 耐心听取用户的退款原因
2. 说明退款流程和时间
3. 提供必要的退款账户信息收集
4. 表达对用户不便的理解`,
  product_question: `你是产品顾问，负责解答用户关于产品规格、使用方法、注意事项等问题。请：
1. 提供准确的产品信息
2. 使用通俗易懂的语言
3. 主动提供使用建议和注意事项
4. 如有不确定的信息，坦诚告知`,
  complaint: `你是投诉处理专员，需要妥善处理用户投诉。请：
1. 首先表达歉意和理解
2. 认真倾听用户的问题
3. 不辩解、不推诿
4. 提供具体的解决方案和补偿措施
5. 保持耐心和同理心`,
  multi_turn: `你是智能客服，需要进行流畅的多轮对话。请：
1. 记住对话上下文
2. 主动询问下一步需求
3. 提供连贯的服务
4. 在适当时机推荐相关产品或服务`,
  general: `你是智能客服助手，专注于为用户提供优质的服务。请：
1. 准确理解用户问题
2. 提供专业、耐心的回答
3. 主动提供帮助和建议
4. 如无法解决，及时转接人工`,
  custom: `你是智能客服助手，专注于为用户提供优质的服务。请：
1. 准确理解用户问题
2. 提供专业、耐心的回答
3. 主动提供帮助和建议
4. 如无法解决，及时转接人工`,
  logistics_query: `你是物流查询专员，负责帮助用户查询物流轨迹、快递公司和签收状态。请：
1. 快速准确地提供物流信息
2. 解释各快递公司的特点
3. 提醒签收注意事项
4. 对异常物流主动预警`,
  address_modify: `你是地址修改专员，负责协助用户修改收货地址和联系人信息。请：
1. 确认用户身份后进行操作
2. 告知地址修改的条件和限制
3. 提醒修改后的配送影响
4. 确认并复述新的地址信息`,
  invoice_request: `你是发票专员，负责处理电子发票和纸质发票申请。请：
1. 确认发票类型和开票信息
2. 说明发票申请流程和时间
3. 提醒发票抬头和税号的准确性
4. 告知发票送达方式和时间`,
  partial_refund: `你是退款计算专员，负责处理部分退款金额计算。请：
1. 明确说明退款金额的计算方式
2. 列出可能影响金额的因素
3. 预估退款到账时间
4. 提供退款进度查询方式`,
  exchange_goods: `你是换货专员，负责处理换货申请和流程指导。请：
1. 了解用户换货原因
2. 说明换货流程和所需材料
3. 告知换货时限和运费规则
4. 提供换货进度查询方式`,
  size_recommend: `你是尺码顾问，负责根据用户的身高体重推荐合适尺码。请：
1. 询问用户的身高体重信息
2. 根据商品尺码表进行推荐
3. 考虑版型特点给出建议
4. 提醒尺码可能存在偏差`,
  product_compare: `你是商品对比顾问，负责帮助用户对比多个商品的规格。请：
1. 客观列出各商品的参数
2. 突出各产品的优缺点
3. 根据用户需求给出建议
4. 不偏袒任何特定商品`,
  escalation: `你是投诉升级处理专员，负责跟进投诉升级事项。请：
1. 认真听取用户的诉求
2. 确认投诉升级的原因
3. 说明当前处理进度
4. 提供预计解决时间`,
  combined: `你是综合服务专员，负责引导用户完成咨询到下单的完整流程。请：
1. 专业解答用户的各种咨询
2. 根据需求推荐合适的商品
3. 协助用户完成下单流程
4. 处理下单过程中的各种问题`,
};

// GET /api/simulations/[id]/messages - Get messages
export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const simulation = await simulationRepository.getById(id);
  
  if (!simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  const messages = await simulationRepository.listMessages(id);
  return apiSuccess({ messages });
});

// POST /api/simulations/[id]/messages - Send a message and get streaming response
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: conversationId } = await params;
  const { data: body, error: parseError } = await parseJsonBody<{ content: string }>(request);
  if (parseError) return parseError;
  
  const userMessage = body?.content;
  if (!userMessage || typeof userMessage !== 'string') {
    return apiError('消息内容不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  // Find simulation
  const simulation = await simulationRepository.getById(conversationId);
  if (!simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  // Get existing messages
  const existingMessages = await simulationRepository.listMessages(conversationId);

  // Add user message
  const userMsg = await simulationRepository.createMessage({
    id: `msg-user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    conversation_id: conversationId,
    role: 'user',
    content: userMessage,
  });

  // Check auto-reply first
  const autoReplyService = new AutoReplyService();
  const autoReply = await autoReplyService.matchReply(userMessage);

  // Prepare stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let responseText = '';

        // If auto-reply matched, return it directly
        if (autoReply) {
          responseText = autoReply.content;
          const assistantMsg = await simulationRepository.createMessage({
            id: `msg-ai-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            conversation_id: conversationId,
            role: 'assistant',
            content: responseText,
            sources: [{ type: 'auto_reply', keyword: autoReply.rule.keyword }],
            confidence: 1.0,
          });

          // Stream the response
          for (const char of responseText) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: char })}\n`));
            await new Promise(resolve => setTimeout(resolve, 15));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, sources: assistantMsg.sources ?? null, confidence: 1.0 })}\n`));
          controller.close();
          return;
        }

        // Get scenario-specific system prompt
        const systemPrompt = SCENARIO_PROMPTS[simulation.scenario_id ?? 'order_inquiry'] || SCENARIO_PROMPTS.order_inquiry;

        // Build conversation history for context (include newly added user message)
        const allMessages = [...existingMessages, userMsg];
        const chatHistory = allMessages
          .filter(m => m.role !== 'system')
          .slice(-20) // Limit to last 20 messages
          .map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

        // Initialize LLM streaming service
        const llmStreamingService = new LLMStreamingService();

        // Get the LLM stream
        const llmStream = llmStreamingService.createStream(
          conversationId,
          userMessage,
          chatHistory,
          {
            systemPrompt: systemPrompt,
          }
        );

        let fullContent = '';
        let sources: Array<{ type: string; content?: string; score?: number; keyword?: string }> | null = null;

        const reader = llmStream.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const parsed = JSON.parse(line.slice(6));
                  if (parsed.content) {
                    fullContent += parsed.content;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: parsed.content })}\n`));
                  }
                  if (parsed.done) {
                    if (parsed.sources) sources = parsed.sources;
                  }
                } catch {
                  // skip malformed chunks
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        // Save assistant message
        const assistantMsg = await simulationRepository.createMessage({
          id: `msg-ai-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          sources,
          confidence: 0.85,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, sources, confidence: assistantMsg.confidence ?? null })}\n`));
        controller.close();
      } catch (error) {
        logger.api.error('[Simulation Messages] Stream error', { error, simulationId: conversationId });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '处理消息时发生错误' })}\n`));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
