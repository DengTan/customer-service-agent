'use client';

import { useEffect, useState } from 'react';
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useThemeSettings } from "@/lib/theme-settings-context";

/** Replaces next-themes' useTheme — reads from ThemeSettingsProvider via localStorage.
 *  Guards window.matchMedia so it only runs on the client (SSR-safe). */
function useCurrentTheme(): string {
  const { settings } = useThemeSettings();
  const [resolved, setResolved] = useState<string>("light");

  useEffect(() => {
    if (settings.theme === "system") {
      setResolved(
        window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      );
    } else {
      setResolved(settings.theme);
    }
  }, [settings.theme]);

  return resolved;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useCurrentTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
