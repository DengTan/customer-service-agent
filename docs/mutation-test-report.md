# Mutation Testing Baseline Report

## Overview

Mutation Testing infrastructure for SmartAssist customer service agent system, powered by Stryker Mutator with Vitest integration.

## Target

- **Sprint 12**: Cover 5 core services
- **Quarterly Goal**: Mutation score >= 60%

## Scope

### Phase 1: Core Services (Sprint 12)

| Service | File | Priority | Notes |
|---------|------|----------|-------|
| conversation-service | `src/server/services/conversation-service.ts` | P0 | Core conversation management |
| message-service | `src/server/services/message-service.ts` | P0 | Message handling |
| customer-service | `src/server/services/customer-service.ts` | P1 | Customer management |
| agent-service | `src/server/services/agent-service.ts` | P1 | Agent/session management |
| knowledge-search-service | `src/server/services/knowledge-search-service.ts` | P1 | Knowledge retrieval |

### Additional Services (Future Phases)

| Service | File | Priority |
|---------|------|----------|
| llm-streaming-service | `src/server/services/llm-streaming-service.ts` | P1 |
| alert-service | `src/server/services/alert-service.ts` | P2 |
| ticket-service | `src/server/services/ticket-service.ts` | P2 |
| quality-service | `src/server/services/quality-service.ts` | P2 |
| marketing-service | `src/server/services/marketing-service.ts` | P2 |

## Configuration

### stryker.config.json

- **Test Runner**: vitest
- **Mutate Scope**: `src/server/services/**/*.ts`
- **Excluded**: `*.test.ts`, `*.spec.ts`
- **Timeout**: 5s per mutant (factor: 1.5)
- **Reports**: progress, clear-text, html

### Thresholds

| Level | Score | Action |
|-------|-------|--------|
| Break | < 40% | CI fails |
| Low | < 50% | Warning |
| High | >= 60% | Target achieved |

## Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Mutation Score | >= 60% | TBD |
| Timeout per Mutant | 5s | - |
| Total Kill Time | < 10min | - |
| Surviving Mutants | Minimize | TBD |

## Infrastructure

### Package Dependencies

```json
{
  "@stryker-mutator/core": "^9.6.1",
  "@stryker-mutator/vitest-runner": "^9.6.1",
  "@stryker-mutator/api": "^9.6.1"
}
```

### NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `stryker:run` | `stryker run` | Run mutation testing |
| `stryker:report` | `stryker report --open` | Open HTML report |

## Action Items

### Phase 1 (Sprint 12)

- [x] Install Stryker packages
- [x] Configure stryker.config.json
- [x] Add npm scripts
- [x] Identify core service files
- [ ] Run baseline mutation test on 5 core services
- [ ] Review surviving mutants
- [ ] Add/improve tests to kill surviving mutants
- [ ] Achieve >= 60% mutation score

### Phase 2 (Future Sprint)

- [ ] Expand coverage to additional services
- [ ] Integrate with CI pipeline
- [ ] Set up dashboard reporting
- [ ] Track mutation score over time

## CI Integration

### Recommended Configuration

```yaml
# .github/workflows/mutation-testing.yml
stryker:
  runs-on: ubuntu-latest
  timeout-minutes: 30
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - run: pnpm install --frozen-lockfile
    - run: pnpm stryker:run
```

## Notes

1. **Computation Intensity**: Mutation testing is CPU-intensive; allocate sufficient CI resources
2. **Test Isolation**: Ensure tests are properly isolated to avoid false positives
3. **Incremental Approach**: Start with single service, expand gradually
4. **Baseline First**: Run without making changes to establish current state

## Generated

- Date: 2026-08-03
- Configuration: `stryker.config.json`
- Reports Location: `reports/mutation/`
