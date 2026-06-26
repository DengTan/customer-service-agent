/**
 * 聊天组件工具函数
 * 统一聊天窗口和对话详情的时间格式和时间分隔线逻辑
 */

import { SSE } from './constants';

/**
 * 消息基础结构（仅包含时间渲染所需的字段）
 */
interface MessageBase {
  created_at: string;
}

/**
 * 格式化消息时间为 HH:mm
 */
export function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 判断两条消息之间是否需要显示时间分隔线
 * 阈值：5 分钟以上的间隔
 */
export function shouldShowTimeDivider<T extends MessageBase>(msg: T, prevMsg: T | undefined): boolean {
  if (!prevMsg) return true;
  const diff = new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime();
  return diff > SSE.TIME_DIVIDER_GAP_MS;
}
