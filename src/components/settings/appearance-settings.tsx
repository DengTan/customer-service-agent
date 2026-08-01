'use client';

import { ToggleLeft, ToggleRight } from 'lucide-react';
import { useEffect } from 'react';
import { useThemeSettings } from '@/lib/theme-settings-context';
import type { ThemeMode } from '@/lib/theme-settings-context';
import { SettingSlider } from '@/components/common/setting-slider';
import { THEME_OPTIONS } from './types';

interface AppearanceSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /**
   * Acceptance contract: all inputs in this section are either bounded
   * `<input type="range">` sliders (browser-enforced step) or boolean
   * toggles, so there is nothing to validate client-side. We accept the
   * prop for API symmetry with the other sub-sections but always report
   * valid.
   */
  onValidationChange?: (isValid: boolean, invalidKey: string | null) => void;
}

export function AppearanceSettings({ settings, onSettingsChange, onValidationChange }: AppearanceSettingsProps) {
  const themeSettingsHook = useThemeSettings();
  const themeSettings = themeSettingsHook.settings;

  // Always valid — see prop docs. Notify parent once on mount in case
  // it gates the save button on our callback firing.
  useEffect(() => {
    onValidationChange?.(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <SettingSlider
          settingKey="font_size"
          id="appearance-font-size"
          label="对话字体大小"
          description="调整聊天界面文字大小（推荐 14px）"
          value={settings.font_size || '14'}
          fallback="14"
          renderValue={(n) => `${Math.round(n)}px`}
          onChange={(v) => {
            themeSettingsHook.setFontSize(v);
            // Sync to parent settings for consistency
            onSettingsChange((prev) => ({ ...prev, font_size: v }));
          }}
          marks={[
            [12, '小'],
            [15, '标准'],
            [18, '大'],
          ]}
        />

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
