// Demo 系统设置数据
import type { SettingRow } from '../types';

export const DEMO_SETTINGS: SettingRow[] = [
  { key: 'theme', value: 'light' },
  { key: 'language', value: 'zh-CN' },
  { key: 'ai_model', value: 'doubao-seed-2-0-lite-260215' },
  { key: 'multimodal_model', value: 'doubao-seed-2-0-pro-260215' },
  { key: 'multimodal_enabled', value: 'true' },
  { key: 'multimodal_disabled_action', value: 'fixed_message' },
  { key: 'multimodal_fixed_message', value: '抱歉，当前未开启图片识别功能，无法识别您发送的图片。如需帮助，请转接人工客服或以文字描述您的问题。' },
  { key: 'auto_handoff_confidence', value: '0.4' },
  { key: 'alert_confidence_threshold', value: '0.4' },
  { key: 'alert_confidence_critical_threshold', value: '0.2' },
  { key: 'alert_high_rounds_threshold', value: '10' },
  { key: 'alert_high_rounds_critical_threshold', value: '15' },
  { key: 'alert_auto_handoff_rounds', value: '6' },
  { key: 'max_conversation_rounds', value: '20' },
  { key: 'ticket_notify_enabled', value: 'true' },
  { key: 'ticket_auto_assign', value: 'false' },
  { key: 'ticket_sla_enabled', value: 'true' },
  { key: 'ticket_sla_response_minutes', value: '{"urgent":15,"high":30,"medium":60,"low":240}' },
  { key: 'ticket_sla_resolve_minutes', value: '{"urgent":120,"high":480,"medium":1440,"low":2880}' },
  { key: 'webhook_secret', value: 'demo-webhook-secret' },
];
