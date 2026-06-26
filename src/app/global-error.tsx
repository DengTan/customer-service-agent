'use client';

import { useEffect } from 'react';

/**
 * Global Error Boundary for the root layout.
 * Catches rendering errors that would otherwise cause a blank white screen.
 * Solves EH-04.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
          color: '#1e293b',
        }}>
          <div style={{
            maxWidth: '480px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '1rem',
            }}>
              ⚠️
            </div>
            <h1 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.75rem',
            }}>
              页面遇到了问题
            </h1>
            <p style={{
              color: '#64748b',
              marginBottom: '1.5rem',
              lineHeight: 1.6,
            }}>
              抱歉，页面渲染时发生了意外错误。请尝试刷新页面，如果问题持续存在，请联系技术支持。
            </p>
            {error.digest && (
              <p style={{
                fontSize: '0.75rem',
                color: '#94a3b8',
                marginBottom: '1rem',
              }}>
                错误追踪 ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                padding: '0.625rem 1.5rem',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseOver={(e) => { (e.target as HTMLButtonElement).style.background = '#1d4ed8'; }}
              onMouseOut={(e) => { (e.target as HTMLButtonElement).style.background = '#2563eb'; }}
            >
              重新加载
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
