/**
 * Shared time formatting utilities.
 * Solves CQ-07: formatTime/formatWaitTime/formatMessageTime were duplicated across components.
 */

/** Format a date string to a human-readable time (HH:mm) */
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** Format a date string to a human-readable date+time (MM-DD HH:mm) */
export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${month}-${day} ${time}`;
}

/** Format a duration (in seconds) to a human-readable wait time string */
export function formatWaitTime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60 ? ` ${seconds % 60}秒` : ''}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}小时${minutes ? ` ${minutes}分` : ''}`;
}

/** Format a message timestamp with smart relative display */
export function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return formatTime(dateStr);
  } else if (diffDays === 1) {
    return `昨天 ${formatTime(dateStr)}`;
  } else if (diffDays < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[date.getDay()]} ${formatTime(dateStr)}`;
  } else {
    return formatDateTime(dateStr);
  }
}
