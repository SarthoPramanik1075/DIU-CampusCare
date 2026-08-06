import { resolve } from 'node:path';

import {
  createFixture,
  extractImports,
  listSourceFiles,
  resolveRelativeImport,
} from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * DR-6 — ARCHITECTURE §3.2: "The domain layer has no framework, HTTP or
 * persistence dependency." Domain files may import only bare package
 * specifiers with no I/O surface (none, in practice — domain code should
 * import nothing but other domain code) plus relative imports that resolve
 * to another `domain/` directory. Any bare-package import at all, or any
 * relative import escaping `domain/`, is a violation.
 *
 * DR-4 (structural half) — ARCHITECTURE §3.2: "No business constant in
 * code; every configurable value flows through Policy." The mechanically
 * checkable half of this is that domain code never imports the policy
 * kernel directly — a domain function that needs a configured value must
 * receive it as a parameter, not reach for `PolicyStore` itself.
 */
const FRAMEWORK_PACKAGES = new Set(['fastify', 'fastify-plugin', 'kysely', 'pg']);

function findDomainImpurities(domainDir: string): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(domainDir, { includeTests: true })) {
    for (const { specifier } of extractImports(file)) {
      const resolved = resolveRelativeImport(file, specifier);

      if (resolved === null) {
        // Bare package specifier. `@campuscare/shared-types` carries only
        // branded primitives (no I/O), so it is not a purity violation;
        // anything else with I/O capability is.
        if (specifier !== '@campuscare/shared-types' && FRAMEWORK_PACKAGES.has(specifier.split('/')[0] ?? '')) {
          violations.push(`${file} imports framework package "${specifier}"`);
        }
        continue;
      }

      if (!isWithinDomainDir(resolved)) {
        violations.push(`${file} imports outside its domain/ directory: "${specifier}"`);
      }
    }
  }
  return violations;

  function isWithinDomainDir(resolvedPath: string): boolean {
    // A resolved relative import is "pure" only if it lands inside some
    // `domain/` directory of the same module (own or, in principle,
    // shared kernel-free domain code) — never `kernel/`, `infrastructure/`
    // or `interface/`.
    return resolvedPath.includes('/domain/') || resolvedPath.endsWith('/domain');
  }
}

function findDomainPolicyImports(domainDir: string): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(domainDir, { includeTests: true })) {
    for (const { specifier } of extractImports(file)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved?.includes('/kernel/policy/')) {
        violations.push(`${file} imports the policy kernel directly: "${specifier}"`);
      }
    }
  }
  return violations;
}

const MODULES_DIR = resolve(import.meta.dirname, '../../src/modules');

function allDomainDirs(): string[] {
  // Currently one module (config); written to generalise as modules are added.
  return ['config'].map((name) => resolve(MODULES_DIR, name, 'domain'));
}

describe('DR-6 · domain purity', () => {
  it('no domain file imports a framework/HTTP/persistence package', () => {
    for (const dir of allDomainDirs()) {
      expect(findDomainImpurities(dir)).toEqual([]);
    }
  });

  it('the scanner catches a deliberate framework import in domain code', () => {
    const fixture = createFixture('dr6-violation');
    try {
      fixture.file(
        'domain/announcement.ts',
        `import type { Kysely } from 'kysely';\nexport interface Announcement { db?: Kysely<unknown> }\n`,
      );
      expect(findDomainImpurities(resolve(fixture.root, 'domain'))).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner catches a domain file reaching into infrastructure', () => {
    const fixture = createFixture('dr6-infra-violation');
    try {
      fixture.file(
        'domain/announcement.ts',
        `import { row } from '../infrastructure/announcement.repository.js';\nexport { row };\n`,
      );
      fixture.file('infrastructure/announcement.repository.ts', 'export const row = {};\n');
      expect(findDomainImpurities(resolve(fixture.root, 'domain'))).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner passes domain code that only imports other domain code', () => {
    const fixture = createFixture('dr6-clean');
    try {
      fixture.file('domain/base.ts', 'export interface Base { id: string }\n');
      fixture.file(
        'domain/announcement.ts',
        `import type { Base } from './base.js';\nexport interface Announcement extends Base {}\n`,
      );
      expect(findDomainImpurities(resolve(fixture.root, 'domain'))).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('DR-4 (structural) · domain code never imports the policy kernel', () => {
  it('no domain file imports kernel/policy directly', () => {
    for (const dir of allDomainDirs()) {
      expect(findDomainPolicyImports(dir)).toEqual([]);
    }
  });

  it('the scanner catches a deliberate domain → policy import', () => {
    const fixture = createFixture('dr4-violation');
    try {
      fixture.file(
        'modules/config/domain/announcement.ts',
        `import { PolicyStore } from '../../../kernel/policy/policy-store.js';\nexport { PolicyStore };\n`,
      );
      fixture.file('kernel/policy/policy-store.ts', 'export class PolicyStore {}\n');

      const violations = findDomainPolicyImports(resolve(fixture.root, 'modules/config/domain'));
      expect(violations).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });
});
