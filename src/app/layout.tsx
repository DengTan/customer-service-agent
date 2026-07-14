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
    '扣子编程',
    'Coze Code',
    'Vibe Coding',
    'AI 编程',
    '智能体搭建',
    '工作流搭建',
    '网站搭建',
    '网站部署',
    '全栈开发',
    'AI 工程师',
  ],
  authors: [{ name: 'Coze Code Team', url: 'https://code.coze.cn' }],
  generator: 'Coze Code',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: '扣子编程 | 你的 AI 工程师已就位',
    description:
      '我正在使用扣子编程 Vibe Coding，让创意瞬间上线。告别拖拽，拥抱心流。',
    url: 'https://code.coze.cn',
    siteName: '扣子编程',
    locale: 'zh_CN',
    type: 'website',
    // images: [
    //   {
    //     url: '',
    //     width: 1200,
    //     height: 630,
    //     alt: '扣子编程 - 你的 AI 工程师',
    //   },
    // ],
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Coze Code | Your AI Engineer is Here',
  //   description:
  //     'Build and deploy full-stack applications through AI conversation. No env setup, just flow.',
  //   // images: [''],
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
