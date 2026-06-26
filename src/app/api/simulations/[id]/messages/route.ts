import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parseJsonBody, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { LLMStreamingService } from '@/server/services/llm-streaming-service';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import type { SimulationMessage } from '@/lib/types';

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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, sources: assistantMsg.sources ?? null })}\n`));
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
                  if (parsed.done && parsed.sources) {
                    sources = parsed.sources;
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

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, sources })}\n`));
        controller.close();
      } catch (error) {
        console.error('[Simulation Messages] Stream error:', error);
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
