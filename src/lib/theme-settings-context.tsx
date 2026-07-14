'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { logger } from '@/lib/logger';

const STORAGE_KEY = 'appearance_settings';

/** Theme mode options */
export type ThemeMode = 'system' | 'light' | 'dark';

/** Shape of the appearance settings stored in localStorage */
export interface ThemeSettings {
  theme: ThemeMode;
  fontSize: string;
  showTimestamps: boolean;
  compactMode: boolean;
}

/** Default settings applied on first load */
const DEFAULT_SETTINGS: ThemeSettings = {
  theme: 'system',
  fontSize: '14',
  showTimestamps: true,
  compactMode: false,
};

/** Settings key mapping: localStorage key -> database key */
const DB_KEY_MAP = {
  theme: 'theme',
  fontSize: 'font_size',
  showTimestamps: 'show_timestamps',
  compactMode: 'compact_mode',
} as const;

/** Context value exposed by ThemeSettingsProvider */
interface ThemeSettingsContextValue {
  settings: ThemeSettings;
  setTheme: (theme: ThemeMode) => void;
  setFontSize: (size: string) => void;
  setShowTimestamps: (show: boolean) => void;
  setCompactMode: (compact: boolean) => void;
  isLoading: boolean;
}

/** Sentinel null value for when hook is used outside provider */
const ThemeSettingsContext = createContext<ThemeSettingsContextValue | null>(null);

/**
 * Load settings from localStorage, falling back to defaults.
 */
function loadSettings(): ThemeSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Persist settings to localStorage.
 */
function saveSettings(settings: ThemeSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Silently ignore storage errors
  }
}

/**
 * Apply theme mode to the document classList.
 */
function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (theme !== 'system') {
    root.classList.add(theme);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add(prefersDark ? 'dark' : 'light');
  }
}

/**
 * Apply CSS custom properties for chat appearance.
 */
function applyCssVars(settings: ThemeSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--chat-font-size', `${settings.fontSize}px`);
  root.style.setProperty('--chat-message-gap', settings.compactMode ? '4px' : '12px');
}

/**
 * Save appearance settings to database via API.
 * Uses the existing /api/settings endpoint.
 */
async function saveToDatabase(settings: ThemeSettings): Promise<void> {
  const dbSettings: Record<string, string> = {
    [DB_KEY_MAP.theme]: settings.theme,
    [DB_KEY_MAP.fontSize]: settings.fontSize,
    [DB_KEY_MAP.showTimestamps]: String(settings.showTimestamps),
    [DB_KEY_MAP.compactMode]: String(settings.compactMode),
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: dbSettings }),
    });
    if (!res.ok) {
      logger.error('[ThemeSettingsProvider] Failed to save settings to database');
    }
  } catch (err) {
    logger.error('[ThemeSettingsProvider] Error saving settings to database', { error: err });
  }
}

/**
 * Fetch appearance settings from database.
 */
async function fetchFromDatabase(): Promise<Partial<ThemeSettings> | null> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return null;
    const data = await res.json();
    const dbSettings = data.settings || {};

    return {
      theme: (dbSettings[DB_KEY_MAP.theme] as ThemeMode) || undefined,
      fontSize: dbSettings[DB_KEY_MAP.fontSize] || undefined,
      showTimestamps: dbSettings[DB_KEY_MAP.showTimestamps] !== undefined
        ? dbSettings[DB_KEY_MAP.showTimestamps] === 'true'
        : undefined,
      compactMode: dbSettings[DB_KEY_MAP.compactMode] !== undefined
        ? dbSettings[DB_KEY_MAP.compactMode] === 'true'
        : undefined,
    };
  } catch (err) {
    logger.error('[ThemeSettingsProvider] Error fetching settings from database', { error: err });
    return null;
  }
}

/**
 * ThemeSettingsProvider – wraps the app and manages appearance preferences.
 *
 * Reads/writes localStorage for immediate UI feedback, syncs to database
 * for persistence across devices/sessions. Database values take priority
 * over localStorage when available.
 */
export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate from localStorage first (for immediate UI), then sync with database
  useEffect(() => {
    const local = loadSettings();
    setSettings(local);
    applyTheme(local.theme);
    applyCssVars(local);
    setIsHydrated(true);

    // Then fetch from database and merge (database takes priority)
    fetchFromDatabase().then((dbSettings) => {
      if (dbSettings) {
        const merged = { ...local, ...dbSettings };
        // Only update if database has different values
        const hasChanges =
          merged.theme !== local.theme ||
          merged.fontSize !== local.fontSize ||
          merged.showTimestamps !== local.showTimestamps ||
          merged.compactMode !== local.compactMode;

        if (hasChanges) {
          setSettings(merged);
          saveSettings(merged);
          applyTheme(merged.theme);
          applyCssVars(merged);
        }
      }
      setIsLoading(false);
    });
  }, []);

  // Re-apply theme whenever it changes (handles system preference change)
  useEffect(() => {
    if (!isHydrated) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(settings.theme);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.theme, isHydrated]);

  const setTheme = useCallback((theme: ThemeMode) => {
    setSettings((prev) => {
      const next = { ...prev, theme };
      saveSettings(next);
      applyTheme(theme);
      // Save to database in background
      saveToDatabase(next);
      return next;
    });
  }, []);

  const setFontSize = useCallback((fontSize: string) => {
    setSettings((prev) => {
      const next = { ...prev, fontSize };
      saveSettings(next);
      applyCssVars(next);
      // Save to database in background
      saveToDatabase(next);
      return next;
    });
  }, []);

  const setShowTimestamps = useCallback((showTimestamps: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, showTimestamps };
      saveSettings(next);
      // Save to database in background
      saveToDatabase(next);
      return next;
    });
  }, []);

  const setCompactMode = useCallback((compactMode: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, compactMode };
      saveSettings(next);
      applyCssVars(next);
      // Save to database in background
      saveToDatabase(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeSettingsContextValue>(
    () => ({
      settings,
      setTheme,
      setFontSize,
      setShowTimestamps,
      setCompactMode,
      isLoading,
    }),
    [settings, setTheme, setFontSize, setShowTimestamps, setCompactMode, isLoading],
  );

  return (
    <ThemeSettingsContext.Provider value={value}>
      {children}
    </ThemeSettingsContext.Provider>
  );
}

/**
 * Hook to access appearance settings.
 *
 * @throws Error if used outside ThemeSettingsProvider
 */
export function useThemeSettings(): ThemeSettingsContextValue {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx) {
    throw new Error('useThemeSettings must be used within ThemeSettingsProvider');
  }
  return ctx;
}
