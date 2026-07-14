import type { AgentQueueItem } from '@/lib/types';
import { FRONTEND } from '@/lib/constants';

// Constants
export const TIME_DIVIDER_MS = FRONTEND.TIME_DIVIDER_MS;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = '10MB';
export const VALID_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
export const POLL_INTERVAL_MS = FRONTEND.POLL_INTERVAL_MS;
export const NOW_REFRESH_INTERVAL_MS = FRONTEND.NOW_REFRESH_INTERVAL_MS;

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'internal_note';
  content: string;
  timestamp: string;
  author_name?: string;
  mentions?: string[];
  attachments?: Attachment[];
}

export function shouldShowTimeDivider(msg: ChatMessage, prevMsg: ChatMessage | undefined) {
  if (!prevMsg) return true;
  const diff = new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime();
  return diff > TIME_DIVIDER_MS;
}

// Stat card component
export function StatCard({ icon, label, value, accentColor }: { icon: React.ReactNode; label: string; value: string; accentColor?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={accentColor ? `text-lg font-bold ${accentColor}` : 'text-sm font-semibold'}>{value}</p>
      </div>
    </div>
  );
}
