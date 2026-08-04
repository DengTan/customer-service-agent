import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { logger } from '../src/lib/logger';

interface DependencyInfo {
  name: string;
  current: string;
  latest: string;
  wanted: string;
  deprecated?: boolean;
}

async function getOutdated(): Promise<DependencyInfo[]> {
  try {
    const output = execSync('pnpm outdated --json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const data = JSON.parse(output);
    const deps: DependencyInfo[] = [];

    for (const [name, info] of Object.entries(data)) {
      const dep = info as Record<string, string>;
      deps.push({
        name,
        current: dep.current,
        latest: dep.latest,
        wanted: dep.wanted,
        deprecated: dep.deprecated === 'true',
      });
    }

    return deps;
  } catch (error) {
    // pnpm outdated returns non-zero exit code if no outdated deps
    if ((error as { status?: number }).status === 0) {
      return [];
    }
    throw error;
  }
}

function generateReport(deps: DependencyInfo[]): string {
  const now = new Date().toISOString();
  let report = `# Dependency Report\n`;
  report += `Generated: ${now}\n\n`;

  if (deps.length === 0) {
    report += `All dependencies are up to date.\n`;
    return report;
  }

  report += `## Summary\n`;
  report += `Total outdated: ${deps.length}\n\n`;

  const major = deps.filter(d => d.current !== d.latest);
  const minor = deps.filter(d => d.wanted !== d.latest);
  const deprecated = deps.filter(d => d.deprecated);

  if (deprecated.length > 0) {
    report += `### Deprecated (Action Required)\n`;
    report += `| Package | Current | Latest | Deprecated |\n`;
    report += `|--------|---------|--------|-------------|\n`;
    for (const d of deprecated) {
      report += `| ${d.name} | ${d.current} | ${d.latest} | Yes |\n`;
    }
    report += `\n`;
  }

  if (major.length > 0) {
    report += `### Major Updates\n`;
    report += `| Package | Current | Latest |\n`;
    report += `|--------|---------|--------|\n`;
    for (const d of major) {
      report += `| ${d.name} | ${d.current} | ${d.latest} |\n`;
    }
    report += `\n`;
  }

  if (minor.length > 0) {
    report += `### Minor/Patch Updates\n`;
    report += `| Package | Current | Wanted | Latest |\n`;
    report += `|--------|---------|--------|--------|\n`;
    for (const d of minor) {
      report += `| ${d.name} | ${d.current} | ${d.wanted} | ${d.latest} |\n`;
    }
    report += `\n`;
  }

  return report;
}

async function main() {
  logger.info('Generating dependency report');

  try {
    const outdated = await getOutdated();
    const report = generateReport(outdated);

    console.log(report);

    // Save to file
    writeFileSync('dependency-report.md', report);
    logger.info('Report saved to dependency-report.md');

    // Check critical dependencies
    const criticalDeps = ['next', 'pdf-parse', '@supabase/supabase-js'];
    const criticalOutdated = outdated.filter(d =>
      criticalDeps.some(c => d.name.includes(c))
    );

    if (criticalOutdated.length > 0) {
      logger.warn('Critical dependencies outdated', {
        deps: criticalOutdated.map(d => d.name)
      });
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error('Failed to generate dependency report', { error });
    process.exit(1);
  }
}

main();
