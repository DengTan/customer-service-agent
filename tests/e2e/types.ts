/**
 * E2E Test Environment Types
 * Phase C2: E2E Authentication Matrix Framework
 */

import type { test, expect } from '@playwright/test';

// Re-export Playwright types for convenience
export type { Page, Request, Response } from '@playwright/test';

// Custom test environment globals
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      E2E_BASE_URL?: string;
      E2E_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
    }
  }
}

// Augment Playwright test for custom matchers if needed
export {};
