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
