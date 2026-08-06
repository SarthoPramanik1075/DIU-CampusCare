import { resolve } from 'node:path';

import {
  createFixture,
  extractImports,
  listSourceFiles,
  resolveRelativeImport,
} from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * DR-3 — ADR-001: "No Core module may import from the Counseling module,
 * and Counseling may import from no Core module." Physically enforced by
 * the two services being separate deployables with separate `node_modules`
 * and no path alias between them; this test makes the "physically" part
 * mechanical rather than trusting that nobody adds a relative `../../../`
 * path that happens to reach across.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const CORE_SRC = resolve(ROOT, 'apps/core-api/src');
const COUNSELING_SRC = resolve(ROOT, 'apps/counseling-api/src');

function findCrossServiceImports(sourceDir: string, forbiddenDir: string): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(sourceDir, { includeTests: true })) {
    for (const { specifier } of extractImports(file)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved?.startsWith(forbiddenDir)) {
        violations.push(`${file} imports "${specifier}" → ${forbiddenDir}`);
      }
    }
  }
  return violations;
}

describe('DR-3 · service isolation (ADR-001)', () => {
  it('no file under core-api/src imports anything under counseling-api/src', () => {
    expect(findCrossServiceImports(CORE_SRC, COUNSELING_SRC)).toEqual([]);
  });

  it('no file under counseling-api/src imports anything under core-api/src', () => {
    expect(findCrossServiceImports(COUNSELING_SRC, CORE_SRC)).toEqual([]);
  });

  // "must fail when deliberately violated" — proves the scanner itself
  // catches the thing it exists to catch, using a synthetic pair of
  // services rather than risking a real cross-import in production source.
  it('the scanner catches a deliberate cross-service import', () => {
    const fixture = createFixture('dr3-violation');
    try {
      const serviceA = fixture.file('service-a/src/index.ts', '');
      fixture.file(
        'service-a/src/leaky.ts',
        `import { something } from '../../service-b/src/domain/thing.js';\nexport { something };\n`,
      );
      fixture.file('service-b/src/domain/thing.js', ''); // never read; only the specifier is inspected
      void serviceA;

      const violations = findCrossServiceImports(
        resolve(fixture.root, 'service-a/src'),
        resolve(fixture.root, 'service-b/src'),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('leaky.ts');
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner passes a clean pair of services with no cross-import', () => {
    const fixture = createFixture('dr3-clean');
    try {
      fixture.file('service-a/src/domain/local.ts', 'export const x = 1;\n');
      fixture.file(
        'service-a/src/uses-local.ts',
        `import { x } from './domain/local.js';\nexport { x };\n`,
      );
      fixture.file('service-b/src/domain/other.ts', 'export const y = 2;\n');

      expect(
        findCrossServiceImports(resolve(fixture.root, 'service-a/src'), resolve(fixture.root, 'service-b/src')),
      ).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
