'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { UserRole } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * User type for authenticated users
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar: string | null;
}

/**
 * Auth context value interface
 */
interface AuthContextValue {
  /** Current authenticated user (null if not logged in) */
  user: AuthUser | null;
  /** Whether auth state has been initialized */
  isLoading: boolean;
  /** Login with email and password */
  login: (email: string, password: string) => Promise<{ success: boolean; user?: AuthUser; error?: string }>;
  /** Logout current user */
  logout: () => Promise<void>;
  /** Check authentication status (fetch from /api/auth/me) */
  checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);


/**
 * AuthProvider - wraps the app and provides authentication state
 * 
 * Note: Since JWT is stored in HTTP-only cookie, auth state needs to be
 * checked on mount by calling /api/auth/me. This component handles that.
 */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check auth status on mount
  useEffect(() => {
    checkAuthInternal().finally(() => setIsLoading(false));
  }, []);

  /**
   * Internal auth check function
   */
  async function checkAuthInternal(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',  // Important: include cookies
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
          return true;
        }
      }
      
      setUser(null);
      return false;
    } catch {
      setUser(null);
      return false;
    }
  }

  /**
   * Login with email and password
   */
  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setUser(data.user);
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || '登录失败' };
      }
    } catch (err) {
      logger.error('[Auth] Login fetch error', { error: err });
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, []);

  /**
   * Logout current user
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setUser(null);
    }
  }, []);

  /**
   * Check authentication status (exposed for manual checks)
   */
  const checkAuth = useCallback(async (): Promise<boolean> => {
    const result = await checkAuthInternal();
    return result;
  }, []);


  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    logout,
    checkAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Hook to get current user only (shorthand)
 */
export function useCurrentUser(): AuthUser | null {
  const { user } = useAuth();
  return user;
}

/**
 * Hook to check if user is logged in
 */
export function useIsAuthenticated(): boolean {
  const { user, isLoading } = useAuth();
  return !isLoading && user !== null;
}
