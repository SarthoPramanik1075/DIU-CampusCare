import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createFixture,
  extractImports,
  listSourceFiles,
  resolveRelativeImport,
} from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * DR-2 — ARCHITECTURE §3.2: "Modules communicate only via the event bus or
 * another module's published `index.ts` interface." A file outside module
 * X may resolve an import into X's directory only if that import targets
 * X's own `index.ts` (its barrel) — never a path that reaches past the
 * barrel into `domain/`, `application/`, `infrastructure/` or `interface/`.
 */
function listModuleNames(modulesDir: string): string[] {
  try {
    return readdirSync(modulesDir).filter((entry) => statSync(resolve(modulesDir, entry)).isDirectory());
  } catch {
    return [];
  }
}

function findModuleBoundaryViolations(srcDir: string, modulesDir: string): string[] {
  const violations: string[] = [];
  const moduleNames = listModuleNames(modulesDir);

  for (const file of listSourceFiles(srcDir, { includeTests: true })) {
    for (const { specifier } of extractImports(file)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved === null) continue;

      for (const name of moduleNames) {
        const moduleRoot = resolve(modulesDir, name);
        const barrel = resolve(moduleRoot, 'index');
        const isInsideModule = file.startsWith(moduleRoot);
        const targetsModule = resolved.startsWith(moduleRoot);
        const targetsBarrel = resolved === barrel;

        if (targetsModule && !isInsideModule && !targetsBarrel) {
          violations.push(`${file} reaches past ${name}'s barrel: "${specifier}"`);
        }
      }
    }
  }
  return violations;
}

const SRC_DIR = resolve(import.meta.dirname, '../../src');
const MODULES_DIR = resolve(import.meta.dirname, '../../src/modules');

describe('DR-2 · module boundaries', () => {
  it('nothing outside a module reaches past its index.ts barrel', () => {
    expect(findModuleBoundaryViolations(SRC_DIR, MODULES_DIR)).toEqual([]);
  });

  it('the scanner catches a deliberate reach-past-the-barrel import', () => {
    const fixture = createFixture('dr2-violation');
    try {
      fixture.file('modules/config/index.ts', 'export const configModule = {};\n');
      fixture.file('modules/config/domain/announcement.ts', 'export interface Announcement {}\n');
      fixture.file(
        'bootstrap/container.ts',
        `import { Announcement } from '../modules/config/domain/announcement.js';\nexport type { Announcement };\n`,
      );

      const violations = findModuleBoundaryViolations(fixture.root, resolve(fixture.root, 'modules'));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('container.ts');
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner allows an import of the module barrel itself', () => {
    const fixture = createFixture('dr2-clean');
    try {
      fixture.file('modules/config/index.ts', 'export const configModule = {};\n');
      fixture.file('modules/config/domain/announcement.ts', 'export interface Announcement {}\n');
      fixture.file(
        'bootstrap/container.ts',
        `import { configModule } from '../modules/config/index.js';\nexport { configModule };\n`,
      );

      expect(findModuleBoundaryViolations(fixture.root, resolve(fixture.root, 'modules'))).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
