import { resolve } from 'node:path';

import {
  createFixture,
  extractImports,
  listSourceFiles,
  resolveRelativeImport,
} from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * DR-1 — ARCHITECTURE §3.2, counseling-api side. No `modules/` directory
 * exists yet in this service (M0.5 ships only the crisis-protocol gate and
 * the feature-flag kernel), so the real-code assertion is currently
 * vacuous — see `listSourceFiles`'s documented behaviour for a directory
 * that does not exist. It is written now, ahead of the first module, so
 * that M1's first counseling module is bound by the rule from its first
 * commit rather than retrofitted.
 */
function findKernelToModuleImports(kernelDir: string, modulesDir: string): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(kernelDir, { includeTests: true })) {
    for (const { specifier } of extractImports(file)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved?.startsWith(modulesDir)) {
        violations.push(`${file} imports "${specifier}" → ${modulesDir}`);
      }
    }
  }
  return violations;
}

const KERNEL_DIR = resolve(import.meta.dirname, '../../src/kernel');
const MODULES_DIR = resolve(import.meta.dirname, '../../src/modules');

describe('DR-1 · kernel independence', () => {
  it('no file under src/kernel imports anything under src/modules', () => {
    expect(findKernelToModuleImports(KERNEL_DIR, MODULES_DIR)).toEqual([]);
  });

  it('the scanner catches a deliberate kernel → module import', () => {
    const fixture = createFixture('dr1-cns-violation');
    try {
      fixture.file(
        'kernel/feature-flags/counseling-gate.ts',
        `import { CaseStatus } from '../../modules/cases/domain/case.js';\nexport type { CaseStatus };\n`,
      );
      fixture.file('modules/cases/domain/case.ts', 'export type CaseStatus = "open" | "closed";\n');

      const violations = findKernelToModuleImports(
        resolve(fixture.root, 'kernel'),
        resolve(fixture.root, 'modules'),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('counseling-gate.ts');
    } finally {
      fixture.cleanup();
    }
  });
});
