'use client';

import { ToggleLeft, ToggleRight } from 'lucide-react';
import { useThemeSettings } from '@/lib/theme-settings-context';
import type { ThemeMode } from '@/lib/theme-settings-context';
import { THEME_OPTIONS } from './types';

interface AppearanceSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function AppearanceSettings({ settings, onSettingsChange }: AppearanceSettingsProps) {
  const themeSettingsHook = useThemeSettings();
  const themeSettings = themeSettingsHook.settings;

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">外观设置</h2>
      <p className="text-xs text-muted-foreground mb-4">自定义界面主题和显示偏好</p>

      <div className="space-y-6">
        {/* Theme */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-3 block">主题模式</label>
          <div className="grid grid-cols-3 gap-3">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.value}
                onClick={() => {
                  themeSettingsHook.setTheme(theme.value as ThemeMode);
                  // Sync to parent settings for consistency
                  onSettingsChange((prev) => ({ ...prev, theme: theme.value }));
                }}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border border-border text-center transition-colors ${
                  themeSettings.theme === theme.value
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/30'
                }`}
              >
                <span className="text-2xl">{theme.icon}</span>
                <span className="text-xs font-medium text-foreground">{theme.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-medium text-foreground block">对话字体大小</label>
            <span className="text-xs text-muted-foreground">{settings.font_size || '14'}px</span>
          </div>
          <input
            type="range"
            min="12"
            max="18"
            step="1"
            value={settings.font_size || '14'}
            onChange={(e) => {
              themeSettingsHook.setFontSize(e.target.value);
              // Sync to parent settings for consistency
              onSettingsChange((prev) => ({ ...prev, font_size: e.target.value }));
            }}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
            <span>小</span>
            <span>标准</span>
            <span>大</span>
          </div>
        </div>

        {/* Message Bubbles */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">显示消息时间戳</p>
              <p className="text-xs text-muted-foreground">在消息旁显示发送时间</p>
            </div>
            <button
              onClick={() => {
                const newValue = !themeSettings.showTimestamps;
                themeSettingsHook.setShowTimestamps(newValue);
                // Sync to parent settings for consistency
                onSettingsChange((prev) => ({ ...prev, show_timestamps: String(newValue) }));
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {themeSettings.showTimestamps ? (
                <ToggleRight className="w-6 h-6 text-primary" />
              ) : (
                <ToggleLeft className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>

        {/* Compact mode */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">紧凑模式</p>
              <p className="text-xs text-muted-foreground">减少消息间距，显示更多内容</p>
            </div>
            <button
              onClick={() => {
                const newValue = !themeSettings.compactMode;
                themeSettingsHook.setCompactMode(newValue);
                // Sync to parent settings for consistency
                onSettingsChange((prev) => ({ ...prev, compact_mode: String(newValue) }));
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {themeSettings.compactMode ? (
                <ToggleRight className="w-6 h-6 text-primary" />
              ) : (
                <ToggleLeft className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
