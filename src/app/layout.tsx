import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth';
import { ThemeSettingsProvider } from '@/lib/theme-settings-context';
import { ConfirmDialogProvider } from '@/components/common/confirm-dialog';
import './globals.css';

/**
 * Inline blocking script: applies the saved theme BEFORE React hydration,
 * eliminating the flash from next-themes defaulting to system preference.
 * Must stay in sync with ThemeSettingsProvider's STORAGE_KEY.
 */
const THEME_SCRIPT = `
(function() {
  try {
    var s = localStorage.getItem('appearance_settings');
    if (!s) return;
    var cfg = JSON.parse(s);
    var theme = cfg.theme;
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
`;

export const metadata: Metadata = {
  title: {
    default: 'SmartAssist 智能客服',
    template: '%s | SmartAssist',
  },
  description: 'SmartAssist 智能客服 Agent — 支持自然语言对话、知识库检索、多轮对话与满意度评价',
  keywords: [
    '智能客服',
    'AI 客服',
    '知识库',
    '自动回复',
    '多轮对话',
    '工单系统',
    '客户管理',
    '工单管理',
    '营销活动',
    'Gorgias 集成',
  ],
  authors: [{ name: 'SmartAssist', url: 'https://smartassist.local' }],
  generator: 'SmartAssist',
  openGraph: {
    title: 'SmartAssist 智能客服',
    description: '企业级智能客服系统，支持自然语言对话、知识库检索、多轮对话、满意度评价。',
    siteName: 'SmartAssist',
    locale: 'zh_CN',
    type: 'website',
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'SmartAssist | Your AI Engineer is Here',
  //   description: 'Enterprise intelligent customer service system.',
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body className={`antialiased`}>
        <AuthProvider>
          <ThemeSettingsProvider>
            <ConfirmDialogProvider>
              {children}
              <Toaster richColors position="top-center" />
            </ConfirmDialogProvider>
          </ThemeSettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
