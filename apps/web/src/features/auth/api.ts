import type { RoleCode } from '@campuscare/shared-types';

import { apiGet, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

/** API §1.5 `GET /auth/session`. */
export interface SessionDto {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly roles: readonly RoleCode[];
  readonly csrfToken: string;
  readonly sessionExpiresAt: string;
}

/** API §1.3 `POST /auth/login` success shape — no `email` field (the caller already knows it). */
export interface LoginResultDto {
  readonly userId: string;
  readonly fullName: string;
  readonly roles: readonly RoleCode[];
  readonly csrfToken: string;
  readonly sessionExpiresAt: string;
  readonly idleTimeoutMinutes: number;
}

export function fetchSession(): Promise<SessionDto> {
  return apiGet<SessionDto>(CORE_API_URL, '/api/v1/auth/session');
}

export function login(email: string, password: string): Promise<LoginResultDto> {
  return apiPost<LoginResultDto>(CORE_API_URL, '/api/v1/auth/login', { email, password });
}

export function logout(csrfToken: string): Promise<void> {
  return apiPost<undefined>(CORE_API_URL, '/api/v1/auth/logout', {}, csrfToken);
}

/** API §1.1 `GET /auth/sso/login` — a redirect, not a fetch: navigating here starts the IdP round trip. */
export function ssoLoginUrl(redirectTo?: string): string {
  const query = redirectTo === undefined ? '' : `?redirectTo=${encodeURIComponent(redirectTo)}`;
  return `${CORE_API_URL}/api/v1/auth/sso/login${query}`;
}
