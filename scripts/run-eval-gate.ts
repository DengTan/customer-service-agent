/**
 * Run Eval Gate Script
 * Phase 4.4 — Executable CI entry point for the regression gate.
 *
 * Usage:
 *   pnpm eval:gate
 *
 * Required environment variables:
 *   EVAL_DATASET_VERSION_ID    — UUID of the golden dataset version
 *
 * Optional environment variables:
 *   EVAL_GATE_TRIGGER          — 'ci' | 'continuous' | 'manual'  (default: 'ci')
 *   EVAL_OPERATOR_ID           — UUID of the operator (optional)
 *   EVAL_CANDIDATE_MIN_SCORE                   (default: 0.75)
 *   EVAL_CANDIDATE_RERANK_BACKEND             (default: 'mock')
 *   EVAL_CANDIDATE_CLAIM_VERIFIER_THRESHOLD   (default: 0.75)
 *   EVAL_CANDIDATE_CONFIDENCE_GATE            (default: 0.4)
 *
 * Exit codes:
 *   0 — pass
 *   1 — warn
 *   2 — fail
 *
 * Output: JSON result to stdout.
 */
import 'dotenv/config';
import { RegressionGateService } from '../src/server/services/eval/regression-gate-service';
import type { CalibrationConfig } from '../src/server/services/eval/calibration-service';

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadCandidateConfig(): CalibrationConfig {
  return {
    min_score: parseFloat(process.env.EVAL_CANDIDATE_MIN_SCORE ?? '0.75'),
    rerank_backend: (process.env.EVAL_CANDIDATE_RERANK_BACKEND ?? 'mock') as CalibrationConfig['rerank_backend'],
    claim_verifier_threshold: parseFloat(process.env.EVAL_CANDIDATE_CLAIM_VERIFIER_THRESHOLD ?? '0.75'),
    confidence_gate: parseFloat(process.env.EVAL_CANDIDATE_CONFIDENCE_GATE ?? '0.4'),
  };
}

function parseTriggeredBy(): 'ci' | 'continuous' | 'manual' {
  const raw = process.env.EVAL_GATE_TRIGGER ?? 'ci';
  if (raw === 'ci' || raw === 'continuous' || raw === 'manual') {
    return raw;
  }
  return 'ci';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEnv(): void {
  const errors: string[] = [];

  if (!process.env.EVAL_DATASET_VERSION_ID) {
    errors.push('EVAL_DATASET_VERSION_ID is required');
  }

  if (!process.env.SUPABASE_URL) {
    errors.push('SUPABASE_URL is required');
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is required');
  }

  if (errors.length > 0) {
    process.stderr.write(
      JSON.stringify({ error: 'Missing required environment variables', details: errors }, null, 2) + '\n',
    );
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateEnv();

  const datasetVersionId = process.env.EVAL_DATASET_VERSION_ID!;
  const triggeredBy = parseTriggeredBy();
  const triggeredByUserId = process.env.EVAL_OPERATOR_ID ?? undefined;
  const candidateConfig = loadCandidateConfig();

  const service = new RegressionGateService();

  try {
    const result = await service.run({
      datasetVersionId,
      candidateConfig,
      triggeredBy,
      triggeredByUserId,
    });

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

    // Exit codes: 0=pass, 1=warn, 2=fail
    if (result.status === 'fail') {
      process.exit(2);
    }
    if (result.status === 'warn') {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      JSON.stringify({ error: 'Regression gate failed', details: message }, null, 2) + '\n',
    );
    process.exit(2);
  }
}

main();
