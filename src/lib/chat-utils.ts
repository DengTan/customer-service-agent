/**
 * 聊天组件工具函数
 * 统一聊天窗口和对话详情的时间格式和时间分隔线逻辑
 */

import { SSE } from './constants';
import { formatMessageTime as formatTime } from './format';

/**
 * 消息基础结构（仅包含时间渲染所需的字段）
 */
interface MessageBase {
  created_at: string;
}

// Re-export formatMessageTime from format.ts for backward compatibility
export { formatTime as formatMessageTime };

/**
 * 判断两条消息之间是否需要显示时间分隔线
 * 阈值：5 分钟以上的间隔
 */
export function shouldShowTimeDivider<T extends MessageBase>(msg: T, prevMsg: T | undefined): boolean {
  if (!prevMsg) return true;
  const diff = new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime();
  return diff > SSE.TIME_DIVIDER_GAP_MS;
}
