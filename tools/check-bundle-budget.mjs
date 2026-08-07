#!/usr/bin/env node
/**
 * Bundle budget check — NFR-PERF-02: "≤500 KB compressed per student view."
 *
 * Sums the gzip size of every JS/CSS asset in a Vite build's `dist/assets/`
 * and fails if the total exceeds the budget. Gzip, not raw size, is what
 * NFR-PERF-02 means by "compressed" — Vite's own build warning threshold is
 * on raw size, which reports numbers roughly 3x larger than what a browser
 * on a real connection actually downloads (a compressed HTTP response),
 * so this script re-measures rather than trusting that warning.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 500 * 1024;
const distDir = process.argv[2] ?? 'apps/web/dist';
const assetsDir = join(distDir, 'assets');

let entries;
try {
  entries = readdirSync(assetsDir);
} catch {
  console.error(`Could not read ${assetsDir} — run \`pnpm --filter @campuscare/web build\` first.`);
  process.exit(1);
}

const assets = entries.filter((name) => ['.js', '.css'].includes(extname(name)));

let totalGzipBytes = 0;
for (const name of assets) {
  const raw = readFileSync(join(assetsDir, name));
  const gzipBytes = gzipSync(raw).length;
  totalGzipBytes += gzipBytes;
  console.log(`  ${name}  ${(gzipBytes / 1024).toFixed(1)} KB gzip`);
}

const totalKb = totalGzipBytes / 1024;
const budgetKb = BUDGET_BYTES / 1024;
console.log(`\nTotal: ${totalKb.toFixed(1)} KB gzip (budget ${budgetKb.toFixed(0)} KB)`);

if (totalGzipBytes > BUDGET_BYTES) {
  console.error(`\nOver budget by ${(totalKb - budgetKb).toFixed(1)} KB — NFR-PERF-02.`);
  process.exit(1);
}
