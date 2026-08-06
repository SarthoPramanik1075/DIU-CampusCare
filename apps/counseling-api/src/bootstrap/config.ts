import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

// Resolved relative to this file, not process.cwd() — the shared .env lives
// at the monorepo root. See apps/core-api/src/bootstrap/config.ts for the
// identical reasoning; the two files are duplicated for the same reason the
// kernel is (ADR-001), not by oversight.
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

export interface AppConfig {
  readonly nodeEnv: string;
  readonly logLevel: string;
  readonly port: number;
  readonly webAppOrigin: string;
  readonly crisisProtocolPath: string;
  readonly featureCounselingEnabled: boolean;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readBooleanFlag(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  return value === undefined ? fallback : value === 'true';
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    port: Number.parseInt(process.env.COUNSELING_API_PORT ?? '3002', 10),
    webAppOrigin: process.env.WEB_APP_ORIGIN ?? 'http://localhost:5173',
    // .env writes this path relative to the repo root (e.g.
    // "./apps/counseling-api/content/crisis-protocol"), so it is resolved
    // against REPO_ROOT here rather than left relative to whatever cwd the
    // process happens to have been started from.
    crisisProtocolPath: resolve(REPO_ROOT, requireEnv('CRISIS_PROTOCOL_PATH')),
    featureCounselingEnabled: readBooleanFlag('FEATURE_COUNSELING_ENABLED', false),
  };
}
