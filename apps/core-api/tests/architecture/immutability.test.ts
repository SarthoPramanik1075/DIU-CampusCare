import { resolve } from 'node:path';

import { createFixture, findMutationCalls, listSourceFiles } from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * Append-only immutability — FR-AUD-02, FR-PAY-10, FR-MED-21, BR-51/61.
 * `audit.audit_log`, `audit.authz_denial`, `billing.payment` and
 * `pharmacy.stock_movement` may only ever be inserted into. The database
 * enforces this with a `REVOKE UPDATE, DELETE` and, for audit_log, a
 * rejecting trigger (DATABASE §9/§11); this test enforces the same
 * guarantee one layer up, at build time, so a Kysely `.updateTable(...)` or
 * `.deleteFrom(...)` against one of these tables never ships even though it
 * would fail loudly in integration testing anyway.
 */
const PROTECTED_TABLES = [
  'audit.audit_log',
  'audit.authz_denial',
  'billing.payment',
  'pharmacy.stock_movement',
] as const;

const SRC_DIR = resolve(import.meta.dirname, '../../src');

describe('append-only immutability', () => {
  it('no source file calls .updateTable/.deleteFrom against a protected table', () => {
    const violations = listSourceFiles(SRC_DIR, { includeTests: true }).flatMap((file) =>
      findMutationCalls(file, PROTECTED_TABLES),
    );
    expect(violations).toEqual([]);
  });

  it('the scanner catches a deliberate .updateTable against audit.audit_log', () => {
    const fixture = createFixture('immutability-violation');
    try {
      const file = fixture.file(
        'repo.ts',
        `db.updateTable('audit.audit_log').set({ note: 'x' }).execute();\n`,
      );
      const violations = findMutationCalls(file, PROTECTED_TABLES);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ method: 'updateTable', table: 'audit.audit_log' });
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner catches a deliberate .deleteFrom against pharmacy.stock_movement', () => {
    const fixture = createFixture('immutability-delete-violation');
    try {
      const file = fixture.file('repo.ts', `db.deleteFrom('pharmacy.stock_movement').execute();\n`);
      const violations = findMutationCalls(file, PROTECTED_TABLES);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ method: 'deleteFrom', table: 'pharmacy.stock_movement' });
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner does not flag mutation calls against an unprotected table', () => {
    const fixture = createFixture('immutability-clean');
    try {
      const file = fixture.file(
        'repo.ts',
        `db.updateTable('config.announcement').set({ title: 'x' }).execute();\n`,
      );
      expect(findMutationCalls(file, PROTECTED_TABLES)).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
