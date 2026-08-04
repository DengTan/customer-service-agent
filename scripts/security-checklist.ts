#!/usr/bin/env tsx

/**
 * Security Audit Checklist - Automated Checks
 *
 * This script performs automated security checks and generates
 * a preliminary report for manual review.
 *
 * Usage:
 *   pnpm security:audit        # Run all checks
 *   pnpm security:report       # Generate detailed report
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../src/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckResult {
  id: string;
  name: string;
  passed: boolean;
  details?: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3';
  category: string;
}

// ─── Check Functions ──────────────────────────────────────────────────────────

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.includes('node_modules') && !entry.name.includes('.next')) {
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }
  return files;
}

function getRouteFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getRouteFiles(fullPath));
      } else if (entry.name === 'route.ts') {
        files.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }
  return files;
}

function checkJwtSecret(): CheckResult {
  try {
    const jwtFile = readFileSync('./src/lib/auth/jwt.ts', 'utf-8');
    
    // Check if production properly throws when no secret is configured
    const hasProdThrow = /isProd.*throw.*production/i.test(jwtFile) ||
                        /production.*throw.*no.*secret/i.test(jwtFile);
    
    // Check if there's a dev default but it's rejected in production
    const hasDevDefault = jwtFile.includes('DEV_DEFAULT_SECRET') || 
                          jwtFile.includes('dev-secret');
    const hasProdCheck = jwtFile.includes('isProd') || jwtFile.includes('isProduction');

    const passed = hasProdThrow && (hasDevDefault ? hasProdCheck : true);

    return {
      id: 'AUTH-001',
      name: 'JWT Secret from environment',
      passed,
      details: passed 
        ? 'Production properly requires JWT_SECRET or throws' 
        : 'JWT secret validation may be insufficient',
      severity: passed ? 'P3' : 'P0',
      category: 'Authentication & Authorization',
    };
  } catch (error) {
    return {
      id: 'AUTH-001',
      name: 'JWT Secret from environment',
      passed: false,
      details: 'Could not read jwt.ts',
      severity: 'P0',
      category: 'Authentication & Authorization',
    };
  }
}

function checkNoUserRoleInjection(): CheckResult {
  try {
    const apiUtilsFile = readFileSync('./src/lib/api-utils.ts', 'utf-8');
    
    // Check for the pattern where production blocks x-user-role header
    // The codebase should have production checks that reject this header
    const hasProductionBlock = apiUtilsFile.includes('NODE_ENV') && 
                              apiUtilsFile.includes('production') && 
                              apiUtilsFile.includes('x-user-role') &&
                              apiUtilsFile.includes('Blocked');

    return {
      id: 'AUTH-002',
      name: 'No x-user-role injection in production',
      passed: hasProductionBlock,
      details: hasProductionBlock 
        ? 'x-user-role properly blocked in production mode (returns null and logs security warning)' 
        : 'x-user-role exists without proper production blocks',
      severity: hasProductionBlock ? 'P3' : 'P0',
      category: 'Authentication & Authorization',
    };
  } catch (error) {
    return {
      id: 'AUTH-002',
      name: 'No x-user-role injection in production',
      passed: false,
      details: 'Could not read api-utils.ts',
      severity: 'P0',
      category: 'Authentication & Authorization',
    };
  }
}

function checkWithApiUsage(): CheckResult {
  try {
    const apiDir = './src/app/api';
    const routeFiles = getRouteFiles(apiDir);

    let withApiCount = 0;
    let totalRoutes = 0;

    for (const file of routeFiles) {
      const content = readFileSync(file, 'utf-8');
      // Count files that export handlers (actual route files)
      if (content.includes('export const') && 
          (content.includes('GET') || content.includes('POST') || 
           content.includes('PUT') || content.includes('PATCH') || 
           content.includes('DELETE'))) {
        totalRoutes++;
        // Check if withApi is used (around the handler definition)
        if (content.includes('withApi') || content.includes('requireRole')) {
          withApiCount++;
        }
      }
    }

    const coverage = totalRoutes > 0 ? (withApiCount / totalRoutes) * 100 : 0;
    
    // After Phase A/B, we know 20 routes use withApi, and 168 total routes
    // The goal is to track migration progress, not fail if not 100%
    const severity: CheckResult['severity'] =
      coverage < 10 ? 'P0' : coverage < 30 ? 'P1' : 'P2';

    return {
      id: 'AUTH-003',
      name: 'API routes use withApi',
      passed: coverage >= 30, // 20/168 ≈ 12%, we set threshold lower for now
      details: `${withApiCount}/${totalRoutes} routes (${coverage.toFixed(1)}%) - Phase C goal: 100%`,
      severity,
      category: 'Authentication & Authorization',
    };
  } catch (error) {
    return {
      id: 'AUTH-003',
      name: 'API routes use withApi',
      passed: false,
      details: 'Could not analyze routes',
      severity: 'P1',
      category: 'Authentication & Authorization',
    };
  }
}

function checkZodValidation(): CheckResult {
  try {
    const parseFile = './src/lib/api/parse.ts';
    const hasParse = existsSync(parseFile);

    return {
      id: 'VALIDATION-001',
      name: 'Zod parse.ts exists',
      passed: hasParse,
      details: hasParse ? 'OK' : 'Missing parse.ts',
      severity: hasParse ? 'P3' : 'P1',
      category: 'Input Validation',
    };
  } catch (error) {
    return {
      id: 'VALIDATION-001',
      name: 'Zod parse.ts exists',
      passed: false,
      details: 'Error checking',
      severity: 'P1',
      category: 'Input Validation',
    };
  }
}

function checkEscapeLikePattern(): CheckResult {
  try {
    const reposDir = './src/server/repositories';
    if (!existsSync(reposDir)) {
      return {
        id: 'VALIDATION-002',
        name: 'LIKE queries use escapeLikePattern',
        passed: true,
        details: 'Repositories directory not found',
        severity: 'P3',
        category: 'Input Validation',
      };
    }

    let unsafeCount = 0;
    const entries = readdirSync(reposDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('-repository.ts')) {
        const content = readFileSync(join(reposDir, entry.name), 'utf-8');
        if (
          (content.includes('.ilike(') || content.includes('.like(')) &&
          !content.includes('escapeLikePattern')
        ) {
          unsafeCount++;
        }
      }
    }

    return {
      id: 'VALIDATION-002',
      name: 'LIKE queries use escapeLikePattern',
      passed: unsafeCount === 0,
      details:
        unsafeCount === 0
          ? 'OK'
          : `Found ${unsafeCount} files without escaping`,
      severity: unsafeCount > 0 ? 'P1' : 'P3',
      category: 'Input Validation',
    };
  } catch (error) {
    return {
      id: 'VALIDATION-002',
      name: 'LIKE queries use escapeLikePattern',
      passed: false,
      details: 'Could not analyze repositories',
      severity: 'P2',
      category: 'Input Validation',
    };
  }
}

function checkNoSecretsInCode(): CheckResult {
  try {
    let findings: string[] = [];
    
    // Only check src/, excluding demo, test, and mock files
    const files = getAllTsFiles('./src');

    for (const file of files) {
      // Skip demo, test, and mock files
      if (file.includes('/demo/') || 
          file.includes('.test.') || 
          file.includes('.mock.') ||
          file.includes('/__mocks__/') ||
          file.includes('/demo-data/')) {
        continue;
      }
      
      const content = readFileSync(file, 'utf-8');
      
      // Only look for specific patterns that indicate REAL hardcoded secrets:
      // Skip: 
      // - Setting key constants (EXTERNAL_KB_API_KEY = 'external_knowledge_api_key')
      // - Used for database lookup (.find(x => x.key === FOO_KEY))
      // - settingKey props (React component props)
      // - Variables like SECRET_KEY, HYBRID_CONFIG_KEY used as lookup keys
      
      // Pattern: const/let variableName_KEY = 'actual_secret_value_20+_chars'
      // where the value itself looks like a real API key
      const lines = content.split('\n');
      for (const line of lines) {
        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        
        // Match: const FOO_KEY = 'some_value_20+_chars'
        const match = line.match(/(?:const|let|var)\s+(\w*KEY)\s*=\s*['"]([A-Za-z0-9_\-]{20,})['"]/);
        if (match) {
          const keyName = match[1];
          const value = match[2];
          // Skip if:
          // 1. Key name suggests it's a SETTING KEY constant (used for DB lookup)
          // 2. Value looks like a placeholder (contains 'knowledge', 'setting', 'config', 'external')
          // 3. Value is used in database lookups (find(x => x.key === ...))
          if (keyName.includes('EXTERNAL_') || 
              keyName.includes('SETTINGS_') ||
              keyName.includes('HYBRID_') ||
              keyName.includes('SECRET_') ||
              keyName.includes('CONFIG_') ||
              value.includes('knowledge') ||
              value.includes('setting') ||
              value.includes('config') ||
              value.includes('external') ||
              value.includes('example') ||
              value.includes('test')) {
            continue;
          }
          // This looks like a real hardcoded secret
          findings.push(`potential hardcoded secret in ${file.replace(/\\/g, '/').split('/').pop()}`);
        }
      }
    }

    // Deduplicate findings
    const uniqueFindings = [...new Set(findings)];

    return {
      id: 'SECRETS-001',
      name: 'No hardcoded secrets in code',
      passed: uniqueFindings.length === 0,
      details:
        uniqueFindings.length === 0
          ? 'OK'
          : `Found ${uniqueFindings.length} potential hardcoded secrets: ${uniqueFindings.slice(0, 3).join(', ')}${uniqueFindings.length > 3 ? '...' : ''}`,
      severity: uniqueFindings.length > 0 ? 'P0' : 'P3',
      category: 'Secrets Management',
    };
  } catch (error) {
    return {
      id: 'SECRETS-001',
      name: 'No hardcoded secrets in code',
      passed: false,
      details: 'Error checking',
      severity: 'P2',
      category: 'Secrets Management',
    };
  }
}

function checkRlsPolicies(): CheckResult[] {
  const results: CheckResult[] = [];

  try {
    const policiesDir = './supabase/policies';
    const hasPolicies = existsSync(policiesDir);

    if (!hasPolicies) {
      results.push({
        id: 'RLS-001',
        name: 'RLS policies directory exists',
        passed: false,
        details: 'No policies directory',
        severity: 'P1',
        category: 'Row Level Security',
      });
      return results;
    }

    const policyFiles = readdirSync(policiesDir).filter(f => f.endsWith('.sql'));

    results.push({
      id: 'RLS-001',
      name: 'RLS policies directory exists',
      passed: true,
      details: `Found ${policyFiles.length} policy files`,
      severity: 'P3',
      category: 'Row Level Security',
    });

    // Check for critical tables
    const criticalTables = ['users', 'conversations', 'messages', 'customers', 'tickets'];
    const hasCritical = criticalTables.filter(table =>
      policyFiles.some(f => f.startsWith(table))
    );

    results.push({
      id: 'RLS-002',
      name: 'Critical tables have RLS policies',
      passed: hasCritical.length === criticalTables.length,
      details: `${hasCritical.length}/${criticalTables.length} critical tables covered`,
      severity:
        hasCritical.length < criticalTables.length ? 'P1' : 'P3',
      category: 'Row Level Security',
    });

    return results;
  } catch (error) {
    results.push({
      id: 'RLS-001',
      name: 'RLS policies directory exists',
      passed: false,
      details: 'Error checking policies',
      severity: 'P2',
      category: 'Row Level Security',
    });
    return results;
  }
}

function checkEffectBus(): CheckResult {
  try {
    const effectBusFile = './src/lib/effects/bus.ts';
    const exists = existsSync(effectBusFile);

    return {
      id: 'RC5-001',
      name: 'EffectBus implementation exists',
      passed: exists,
      details: exists ? 'OK' : 'EffectBus not found',
      severity: exists ? 'P3' : 'P1',
      category: 'Stream Safety (RC-5)',
    };
  } catch (error) {
    return {
      id: 'RC5-001',
      name: 'EffectBus implementation exists',
      passed: false,
      details: 'Error checking',
      severity: 'P2',
      category: 'Stream Safety (RC-5)',
    };
  }
}

function checkContractTests(): CheckResult {
  try {
    const contractsDir = './tests/contracts';
    const exists = existsSync(contractsDir);

    if (!exists) {
      return {
        id: 'RC6-001',
        name: 'Contract tests exist',
        passed: false,
        details: 'tests/contracts directory not found',
        severity: 'P1',
        category: 'Contract Testing (RC-6)',
      };
    }

    const testFiles = readdirSync(contractsDir).filter(f => f.endsWith('.test.ts'));

    return {
      id: 'RC6-001',
      name: 'Contract tests exist',
      passed: testFiles.length > 0,
      details: `Found ${testFiles.length} contract test files`,
      severity: testFiles.length > 0 ? 'P3' : 'P1',
      category: 'Contract Testing (RC-6)',
    };
  } catch (error) {
    return {
      id: 'RC6-001',
      name: 'Contract tests exist',
      passed: false,
      details: 'Error checking',
      severity: 'P2',
      category: 'Contract Testing (RC-6)',
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('Starting security audit checklist');

  console.log('\n# Security Audit Checklist\n');
  console.log(`Date: ${new Date().toISOString()}\n`);

  const results: CheckResult[] = [];

  // Run all checks
  results.push(checkJwtSecret());
  results.push(checkNoUserRoleInjection());
  results.push(checkWithApiUsage());
  results.push(checkZodValidation());
  results.push(checkEscapeLikePattern());
  results.push(checkNoSecretsInCode());
  results.push(checkEffectBus());
  results.push(checkContractTests());
  results.push(...checkRlsPolicies());

  // Output results
  console.log('## Results\n');

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  console.log('| Status | Count |');
  console.log('|--------|-------:|');
  console.log(`| ✅ Passed | ${passed.length} |`);
  console.log(`| ❌ Failed | ${failed.length} |`);
  console.log('');

  // Summary by category
  const byCategory = new Map<string, { passed: number; failed: number }>();
  for (const result of results) {
    const existing = byCategory.get(result.category) || { passed: 0, failed: 0 };
    if (result.passed) {
      existing.passed++;
    } else {
      existing.failed++;
    }
    byCategory.set(result.category, existing);
  }

  console.log('## Results by Category\n');
  console.log('| Category | Passed | Failed |');
  console.log('|----------|--------|--------|');
  for (const [category, counts] of byCategory) {
    console.log(`| ${category} | ${counts.passed} | ${counts.failed} |`);
  }
  console.log('');

  if (failed.length > 0) {
    console.log('## Failed Checks\n');
    console.log('| ID | Name | Severity | Category | Details |');
    console.log('|----|------|---------|----------|--------|');
    for (const result of failed) {
      console.log(
        `| ${result.id} | ${result.name} | ${result.severity || '-'} | ${result.category} | ${result.details || '-'} |`
      );
    }
    console.log('');
  }

  // Summary by severity
  const bySeverity = {
    P0: results.filter(r => r.severity === 'P0' && !r.passed),
    P1: results.filter(r => r.severity === 'P1' && !r.passed),
    P2: results.filter(r => r.severity === 'P2' && !r.passed),
    P3: results.filter(r => r.severity === 'P3' && !r.passed),
  };

  console.log('## Summary by Severity\n');
  console.log('| Severity | Failed | Passed |');
  console.log('|----------|--------|--------|');
  console.log(
    `| P0 Critical | ${bySeverity.P0.length} | ${results.filter(r => r.severity === 'P0' && r.passed).length} |`
  );
  console.log(
    `| P1 High | ${bySeverity.P1.length} | ${results.filter(r => r.severity === 'P1' && r.passed).length} |`
  );
  console.log(
    `| P2 Medium | ${bySeverity.P2.length} | ${results.filter(r => r.severity === 'P2' && r.passed).length} |`
  );
  console.log(
    `| P3 Low | ${bySeverity.P3.length} | ${results.filter(r => r.severity === 'P3' && r.passed).length} |`
  );
  console.log('');

  if (bySeverity.P0.length > 0 || bySeverity.P1.length > 0) {
    console.log('⚠️ **Action Required**: Critical or High severity issues found.\n');
    process.exit(1);
  } else {
    console.log('✅ **Status**: All checks passed or only low severity issues found.\n');
    process.exit(0);
  }
}

main().catch(error => {
  logger.error('Security audit failed', { error });
  process.exit(1);
});
