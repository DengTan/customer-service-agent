/**
 * Server Status Check Utility
 * Phase C2: E2E Authentication Matrix Framework
 * 
 * Utility to check if the dev server is running and responsive
 */

import { testLogger } from '../logger';

const serverLogger = testLogger;

export interface ServerStatus {
  running: boolean;
  url: string;
  responseTime?: number;
  error?: string;
}

/**
 * Check if the server is running and responsive
 */
export async function checkServerStatus(baseURL: string = 'http://localhost:5000'): Promise<ServerStatus> {
  const start = Date.now();
  
  try {
    const response = await fetch(baseURL, {
      method: 'GET',
      redirect: 'manual', // We expect a redirect, so don't follow it
    });
    
    const responseTime = Date.now() - start;
    
    // Any response (even redirect) means server is running
    serverLogger.info(`Server is running at ${baseURL}`, {
      responseTime,
      status: response.status,
    });
    
    return {
      running: true,
      url: baseURL,
      responseTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serverLogger.error(`Server is not running at ${baseURL}`, { error: errorMessage });
    
    return {
      running: false,
      url: baseURL,
      error: errorMessage,
    };
  }
}

/**
 * Wait for server to be ready
 */
export async function waitForServer(
  baseURL: string = 'http://localhost:5000',
  timeout: number = 120_000,
  interval: number = 2000
): Promise<boolean> {
  const start = Date.now();
  
  serverLogger.info(`Waiting for server at ${baseURL}...`);
  
  while (Date.now() - start < timeout) {
    const status = await checkServerStatus(baseURL);
    if (status.running) {
      serverLogger.info(`Server ready after ${Date.now() - start}ms`);
      return true;
    }
    
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  
  serverLogger.error(`Server did not become ready within ${timeout}ms`);
  return false;
}

/**
 * Get current server URL from environment or default
 */
export function getServerURL(): string {
  return process.env.E2E_BASE_URL || 'http://localhost:5000';
}
