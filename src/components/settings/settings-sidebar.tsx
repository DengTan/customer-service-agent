'use client';

import { MessageSquare, Palette, Cpu, AlertTriangle, Store, Users, Bell, Network, Globe, GraduationCap } from 'lucide-react';

export type SectionType = 'auto-reply' | 'chat' | 'ai' | 'alert' | 'appearance' | 'shop' | 'agent-assignment' | 'push' | 'bot' | 'gorgias' | 'knowledge-learning';

interface SettingsSidebarProps {
  activeSection: SectionType;
  onSectionChange: (section: SectionType) => void;
}

const SECTIONS: Array<{ key: SectionType; label: string; icon: typeof MessageSquare }> = [
  { key: 'auto-reply', label: '自动回复规则', icon: MessageSquare },
  { key: 'chat', label: '对话设置', icon: MessageSquare },
  { key: 'ai', label: 'AI 模型', icon: Cpu },
  { key: 'alert', label: '异常告警', icon: AlertTriangle },
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'shop', label: '店铺管理', icon: Store },
  { key: 'agent-assignment', label: '坐席分配', icon: Users },
  { key: 'push', label: '主动推送', icon: Bell },
  { key: 'bot', label: 'Bot与子Agent', icon: Network },
  { key: 'gorgias', label: 'Gorgias 集成', icon: Globe },
  { key: 'knowledge-learning', label: '知识自学习', icon: GraduationCap },
];

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <div className="w-48 border-r border-border bg-card/50 py-4 px-3 shrink-0">
      <nav className="space-y-0.5">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => onSectionChange(s.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 text-left ${
                activeSection === s.key
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Icon className="w-4 h-4" />
              {s.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export { SECTIONS };
