import { resolve } from 'node:path';

import { createFixture, findMutationCalls, listSourceFiles } from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * Append-only immutability, counseling-api side — FR-CSE-15/16, BR-51.
 * `clinical_audit.counseling_access_log` records every read of a case and
 * may only ever be inserted into; the database backs this with a rejecting
 * trigger (DATABASE §11, `trg_access_log_immutable`) and a `REVOKE UPDATE,
 * DELETE`. No query builder is a dependency of this service yet (M0.5 ships
 * no case data access), so the real-code assertion is currently vacuous —
 * written ahead of M1's first case-access code path for the same reason as
 * the sibling `kernel-independence.test.ts`.
 */
const PROTECTED_TABLES = ['clinical_audit.counseling_access_log'] as const;

const SRC_DIR = resolve(import.meta.dirname, '../../src');

describe('append-only immutability', () => {
  it('no source file calls .updateTable/.deleteFrom against a protected table', () => {
    const violations = listSourceFiles(SRC_DIR, { includeTests: true }).flatMap((file) =>
      findMutationCalls(file, PROTECTED_TABLES),
    );
    expect(violations).toEqual([]);
  });

  it('the scanner catches a deliberate .updateTable against counseling_access_log', () => {
    const fixture = createFixture('immutability-cns-violation');
    try {
      const file = fixture.file(
        'repo.ts',
        `db.updateTable('clinical_audit.counseling_access_log').set({ note: 'x' }).execute();\n`,
      );
      const violations = findMutationCalls(file, PROTECTED_TABLES);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        method: 'updateTable',
        table: 'clinical_audit.counseling_access_log',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner does not flag mutation calls against an unprotected table', () => {
    const fixture = createFixture('immutability-cns-clean');
    try {
      const file = fixture.file(
        'repo.ts',
        `db.updateTable('counseling.counseling_case').set({ status: 'closed' }).execute();\n`,
      );
      expect(findMutationCalls(file, PROTECTED_TABLES)).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
