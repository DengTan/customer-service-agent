-- Migration: Seed default bot with sub-agents
-- Description: Ensure the default bot has tools and 3 sub-agents configured
-- Created: 2026-07-07

-- Step 1: Upsert the default bot with tools
INSERT INTO bot_configs (id, name, description, system_prompt, tools, knowledge_ids, is_default, is_sub_agent, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'SmartAssist 智能客服',
  '默认智能客服 Bot，处理售前咨询、订单查询、物流跟踪、售后服务等常见问题',
  '你是 SmartAssist 智能客服助手。你需要：
1. 礼貌、专业的回复
2. 准确回答用户问题
3. 遇到无法回答的问题时，引导转人工
4. 积极主动地提供帮助',
  '["order_query", "logistics_query", "refund_action"]'::jsonb,
  '[]'::jsonb,
  true,
  false,
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  tools = EXCLUDED.tools,
  knowledge_ids = EXCLUDED.knowledge_ids,
  is_default = EXCLUDED.is_default,
  is_sub_agent = EXCLUDED.is_sub_agent,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Ensure only one default bot
UPDATE bot_configs
SET is_default = false
WHERE is_default = true
  AND name != 'SmartAssist 智能客服';

-- Step 2: Upsert sub-agents (order/query, refund, after-sales)
INSERT INTO bot_configs (id, name, description, system_prompt, tools, knowledge_ids, parent_bot_id, delegation_prompt, collaboration_config, is_sub_agent, status)
VALUES
  (
    '00000000-0000-0000-0000-000000000011',
    '订单处理专家',
    '专门处理订单查询、修改地址、取消订单等订单相关问题',
    '你是 SmartAssist 的订单处理专家。你专门负责处理与订单相关的问题，包括查询订单状态、修改收货地址、取消订单、查看订单详情等。请用专业、高效的语气帮助客户解决订单问题。如果遇到非订单相关的问题，请告知客户将转接给其他专家处理。',
    '["order_query", "logistics_query"]'::jsonb,
    '[]'::jsonb,
    '00000000-0000-0000-0000-000000000001',
    '当用户询问订单状态、物流信息、修改地址、取消订单等与订单直接相关的问题时，委派给此子Agent',
    '{"can_collaborate_with": ["00000000-0000-0000-0000-000000000012", "00000000-0000-0000-0000-000000000013"], "communication_mode": "async"}'::jsonb,
    true,
    'active'
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    '退款处理专家',
    '专门处理退款申请、退款进度查询、退款争议等问题',
    '你是 SmartAssist 的退款处理专家。你专门负责处理与退款相关的问题，包括申请退款、查询退款进度、处理退款争议、退款政策解释等。请用耐心、体贴的语气帮助客户解决退款问题。如果需要同时处理订单问题，可以与订单处理专家协作。',
    '["refund_action", "order_query"]'::jsonb,
    '[]'::jsonb,
    '00000000-0000-0000-0000-000000000001',
    '当用户申请退款、查询退款进度、退款纠纷、退款政策等与退款直接相关的问题时，委派给此子Agent',
    '{"can_collaborate_with": ["00000000-0000-0000-0000-000000000011", "00000000-0000-0000-0000-000000000013"], "communication_mode": "async"}'::jsonb,
    true,
    'active'
  ),
  (
    '00000000-0000-0000-0000-000000000013',
    '售后维权专家',
    '专门处理退换货、维权投诉、质量问题等售后问题',
    '你是 SmartAssist 的售后维权专家。你专门负责处理退换货、维权投诉、商品质量问题、收货纠纷等售后问题。请用耐心、公正的语气帮助客户解决售后问题，保护消费者权益的同时维护店铺利益。',
    '["order_query", "refund_action"]'::jsonb,
    '[]'::jsonb,
    '00000000-0000-0000-0000-000000000001',
    '当用户反映商品质量问题、要求换货、投诉维权、收货纠纷等售后问题时，委派给此子Agent',
    '{"can_collaborate_with": ["00000000-0000-0000-0000-000000000011", "00000000-0000-0000-0000-000000000012"], "communication_mode": "async"}'::jsonb,
    true,
    'active'
  )
ON CONFLICT (id) DO UPDATE SET
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  tools = EXCLUDED.tools,
  knowledge_ids = EXCLUDED.knowledge_ids,
  parent_bot_id = EXCLUDED.parent_bot_id,
  delegation_prompt = EXCLUDED.delegation_prompt,
  collaboration_config = EXCLUDED.collaboration_config,
  is_sub_agent = EXCLUDED.is_sub_agent,
  status = EXCLUDED.status,
  updated_at = NOW();
