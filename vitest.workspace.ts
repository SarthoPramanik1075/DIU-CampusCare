import { defineWorkspace } from 'vitest/config';

/**
 * Test projects.
 *
 * Split by *cost and dependency*, not by package, so CI can run the cheap,
 * always-correct suites on every commit and gate the expensive ones.
 *
 *   unit          — pure, no I/O. Milliseconds.
 *   architecture  — assertions about the shape of the system (DR-1…DR-7,
 *                   database isolation, append-only immutability). These are
 *                   the guard rails; ARCHITECTURE §3.2 requires the build to
 *                   fail on violation.
 *   integration   — real PostgreSQL. Every CHECK, EXCLUDE, partial unique
 *                   index and trigger is asserted here rather than mocked,
 *                   because the schema is where those invariants live.
 *   contract      — HTTP shape against API.md.
 */
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'architecture',
      include: ['apps/*/tests/architecture/**/*.test.ts'],
      environment: 'node',
      // Architecture tests read the filesystem and parse imports; they are
      // slower than unit tests but must never be skipped.
      testTimeout: 30_000,
    },
  },
  {
    test: {
      name: 'integration',
      include: ['apps/*/tests/integration/**/*.test.ts'],
      environment: 'node',
      // Each file provisions and drops its own scratch database.
      fileParallelism: false,
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  },
  {
    test: {
      name: 'contract',
      include: ['apps/*/tests/contract/**/*.test.ts'],
      environment: 'node',
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
]);
