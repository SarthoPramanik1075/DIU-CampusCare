import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ALWAYS_EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

export interface ListSourceFilesOptions {
  /** Include `*.test.ts` files. Default `false` — most architecture rules concern production code only. */
  readonly includeTests?: boolean;
}

/**
 * Recursively lists `.ts` files under `dir`.
 *
 * Returns an empty array, rather than throwing, when `dir` does not exist —
 * a service with no `modules/` directory yet (counseling-api, as of M0.5)
 * has vacuously satisfied any rule about what that directory may not
 * contain, and an architecture test should say so by passing, not by
 * erroring on a path that legitimately doesn't exist yet.
 */
export function listSourceFiles(dir: string, options: ListSourceFilesOptions = {}): string[] {
  const { includeTests = false } = options;
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return; // `current` does not exist — nothing to list.
    }

    for (const entry of entries) {
      if (ALWAYS_EXCLUDED_DIRS.has(entry)) continue;
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (extname(fullPath) !== '.ts') continue;
      if (!includeTests && fullPath.endsWith('.test.ts')) continue;

      results.push(fullPath);
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Lists the immediate subdirectory names of `modulesDir` — i.e. the
 * module names under a service's `src/modules/`. Used by every
 * per-module architecture rule (DR-2, DR-4, DR-6, DR-7) so that adding a
 * new module (`modules/iam`, `modules/sch`, ...) makes it subject to
 * those rules automatically, with no test file to remember to update.
 *
 * Returns an empty array, rather than throwing, when `modulesDir` does
 * not exist yet — same reasoning as {@link listSourceFiles}.
 */
export function listModuleNames(modulesDir: string): string[] {
  try {
    return readdirSync(modulesDir).filter((entry) => statSync(join(modulesDir, entry)).isDirectory());
  } catch {
    return [];
  }
}
