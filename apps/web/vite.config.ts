import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * `envDir` points at the repo root so this app reads the same `.env` every
 * service resolves against (see `apps/counseling-api/src/bootstrap/config.ts`
 * for the same pattern) — only the `VITE_`-prefixed keys are ever exposed to
 * client code, so the database credentials and session secret alongside them
 * in that file never reach the bundle.
 */
export default defineConfig({
  plugins: [react()],
  envDir: resolve(import.meta.dirname, '../..'),
  build: {
    // NFR-PERF-02 — 500 KB compressed per student view. Sourcemaps are
    // excluded from that budget (they are never shipped to the browser),
    // but disabling them for now keeps the CI budget check measuring only
    // what a user's connection actually pays for.
    sourcemap: false,
  },
});
