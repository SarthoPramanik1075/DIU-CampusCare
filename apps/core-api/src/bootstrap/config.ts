import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

// Resolved relative to this file, not to process.cwd() — pnpm runs package
// scripts with cwd set to the package directory, but .env lives at the
// monorepo root, alongside the other services that share it.
loadDotenv({ path: resolve(import.meta.dirname, '../../../../.env') });

export interface AppConfig {
  readonly nodeEnv: string;
  readonly logLevel: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly webAppOrigin: string;
  /** BR-68: the vault's own deployment gate. core-api holds no counseling routes to gate, but shares the flag so both services agree on it. */
  readonly featureCounselingEnabled: boolean;
  readonly featureEmailEnabled: boolean;
  /** API §0.2: HMAC key the CSRF token is derived from. Never used to sign or encrypt anything else. */
  readonly sessionSecret: string;
  /**
   * FR-AUTH-01/CON-05: "SSO availability is not guaranteed." `undefined`
   * (any of the four unset) is a normal, supported configuration — no real
   * DIU identity provider exists in development — and degrades to API
   * §1.1's `SSO_UNAVAILABLE` path rather than failing to start.
   */
  readonly sso:
    | { readonly issuerUrl: string; readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string }
    | undefined;
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

function loadSsoConfig(): AppConfig['sso'] {
  const issuerUrl = process.env.SSO_ISSUER_URL;
  const clientId = process.env.SSO_CLIENT_ID;
  const clientSecret = process.env.SSO_CLIENT_SECRET;
  const redirectUri = process.env.SSO_REDIRECT_URI;

  if (issuerUrl === undefined && clientId === undefined && clientSecret === undefined && redirectUri === undefined) {
    return undefined;
  }
  // Partial configuration is a deployment mistake, not a supported state —
  // unlike "all four absent", which is the documented SSO_UNAVAILABLE path.
  return {
    issuerUrl: requireEnv('SSO_ISSUER_URL'),
    clientId: requireEnv('SSO_CLIENT_ID'),
    clientSecret: requireEnv('SSO_CLIENT_SECRET'),
    redirectUri: requireEnv('SSO_REDIRECT_URI'),
  };
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    port: Number.parseInt(process.env.CORE_API_PORT ?? '3001', 10),
    databaseUrl: requireEnv('CORE_DATABASE_URL'),
    webAppOrigin: process.env.WEB_APP_ORIGIN ?? 'http://localhost:5173',
    featureCounselingEnabled: readBooleanFlag('FEATURE_COUNSELING_ENABLED', false),
    featureEmailEnabled: readBooleanFlag('FEATURE_EMAIL_ENABLED', false),
    sessionSecret: requireEnv('SESSION_SECRET'),
    sso: loadSsoConfig(),
  };
}
