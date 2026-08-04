/**
 * E2E Test Setup & Health Check Script
 * Phase C2: E2E Authentication Matrix Framework
 * 
 * Run this script to verify the environment is ready for E2E tests:
 *   npx tsx scripts/e2e-setup.ts
 */

import { testLogger } from '../tests/e2e/logger';

async function main() {
  testLogger.info('=== E2E Test Environment Check ===\n');

  let allPassed = true;

  // 1. Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  testLogger.info(`Node.js version: ${nodeVersion}`);
  if (majorVersion >= 18) {
    testLogger.info('✓ Node.js version is compatible (>=18)');
  } else {
    testLogger.error('✗ Node.js version is too old (need >=18)');
    allPassed = false;
  }

  // 2. Check Playwright installation
  testLogger.info('\nChecking Playwright...');
  try {
    const { chromium } = await import('@playwright/test');
    testLogger.info('✓ Playwright is installed');
  } catch (error) {
    testLogger.error('✗ Playwright is not installed');
    testLogger.info('  Run: npx playwright install chromium --with-deps');
    allPassed = false;
  }

  // 3. Check dev server
  testLogger.info('\nChecking dev server...');
  try {
    const response = await fetch('http://localhost:5000', {
      method: 'GET',
      redirect: 'manual',
    });
    testLogger.info(`✓ Dev server is running (status: ${response.status})`);
  } catch (error) {
    testLogger.warn('✗ Dev server is not running');
    testLogger.info('  Run: pnpm dev:win');
    testLogger.info('  The test runner will start it automatically if configured');
  }

  // 4. Check test files
  testLogger.info('\nChecking E2E test files...');
  const fs = await import('fs');
  const path = await import('path');
  
  const requiredFiles = [
    'playwright.config.ts',
    'tests/e2e/auth-matrix.spec.ts',
    'tests/e2e/helpers/roles.ts',
    'tests/e2e/helpers/auth.ts',
    'tests/e2e/logger.ts',
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      testLogger.info(`✓ ${file}`);
    } else {
      testLogger.error(`✗ ${file} not found`);
      allPassed = false;
    }
  }

  // Summary
  testLogger.info('\n=== Summary ===');
  if (allPassed) {
    testLogger.info('✓ All checks passed!');
    testLogger.info('\nRun E2E tests with:');
    testLogger.info('  pnpm test:e2e           # Run all E2E tests');
    testLogger.info('  pnpm test:e2e:ui        # Run with UI');
    testLogger.info('  pnpm test:e2e:headed     # Run with headed browser');
  } else {
    testLogger.error('✗ Some checks failed. Please fix the issues above.');
  }

  return allPassed;
}

main()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    testLogger.error('Setup check failed with error:', { error: String(error) });
    process.exit(1);
  });
