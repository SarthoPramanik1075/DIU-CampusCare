import { resolve } from 'node:path';

import {
  createFixture,
  extractImports,
  listSourceFiles,
  resolveRelativeImport,
} from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * DR-1 — ARCHITECTURE §3.2: "The kernel may not import from any module."
 * The kernel is the platform every module depends on (auth, audit, policy,
 * events); a kernel that reaches back into a module would create a cycle
 * and make the kernel impossible to reason about or reuse in the other
 * service.
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
    const fixture = createFixture('dr1-violation');
    try {
      fixture.file(
        'kernel/policy/policy-store.ts',
        `import { Announcement } from '../../modules/config/domain/announcement.js';\nexport type { Announcement };\n`,
      );
      fixture.file('modules/config/domain/announcement.ts', 'export interface Announcement {}\n');

      const violations = findKernelToModuleImports(
        resolve(fixture.root, 'kernel'),
        resolve(fixture.root, 'modules'),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('policy-store.ts');
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner passes a kernel file that only imports other kernel files', () => {
    const fixture = createFixture('dr1-clean');
    try {
      fixture.file('kernel/clock/clock.ts', 'export interface Clock { now(): Date }\n');
      fixture.file(
        'kernel/policy/policy-store.ts',
        `import type { Clock } from '../clock/clock.js';\nexport class PolicyStore { constructor(private c: Clock) {} }\n`,
      );

      expect(
        findKernelToModuleImports(resolve(fixture.root, 'kernel'), resolve(fixture.root, 'modules')),
      ).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
