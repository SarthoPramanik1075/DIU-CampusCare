import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A disposable directory of synthetic `.ts` files, for proving an
 * architecture rule's scanner actually catches what it claims to — "each
 * fails when deliberately violated... is the only proof a guard rail
 * works" (ROADMAP.md §6.3). Every architecture test in this suite runs its
 * scanner against both real source (expecting zero violations) and one of
 * these fixtures (expecting the violation it was built to contain).
 */
export interface Fixture {
  readonly root: string;
  file(relativePath: string, contents: string): string;
  cleanup(): void;
}

export function createFixture(prefix: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return {
    root,
    file(relativePath: string, contents: string): string {
      const fullPath = join(root, relativePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, contents, 'utf8');
      return fullPath;
    },
    cleanup(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
