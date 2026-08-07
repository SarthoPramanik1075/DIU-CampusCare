import { describe, expect, it, vi } from 'vitest';

import type { CsrfTokenService } from '../../../../kernel/identity/csrf.js';
import type { SessionStore } from '../../../../kernel/identity/session-store.js';
import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import type { AuthenticationRepository } from '../authentication-repository.js';

import { GetSessionQuery } from './get-session.query.js';

const PEEKED = {
  id: 'session-1',
  userAccountId: 'user-1',
  issuedAt: new Date('2026-08-03T14:00:00+06:00'),
  expiresAt: new Date('2026-08-03T14:30:00+06:00'),
  lastSeenAt: new Date('2026-08-03T14:00:00+06:00'),
  clientFingerprint: null,
};

const TOUCHED = { ...PEEKED, expiresAt: new Date('2026-08-03T15:00:00+06:00') };

const ACCOUNT = { id: 'user-1', email: 'student@diu.edu.bd', fullName: 'Nusrat Jahan', status: 'active' as const, version: 1 };

function buildQuery(overrides: { readonly repository?: Partial<AuthenticationRepository> } = {}) {
  const sessionStore = {
    peek: vi.fn().mockResolvedValue(PEEKED),
    validateAndTouch: vi.fn().mockResolvedValue(TOUCHED),
  } as unknown as SessionStore;

  const repository: AuthenticationRepository = {
    findAccountWithCredentialByEmail: vi.fn(),
    findAccountById: vi.fn().mockResolvedValue(ACCOUNT),
    loadActiveRoleCodes: vi.fn().mockResolvedValue(['STU']),
    recordFailedAttempt: vi.fn(),
    resetFailedAttempts: vi.fn(),
    recordLoginAttempt: vi.fn(),
    findOrProvisionBySsoSubject: vi.fn(),
    ...overrides.repository,
  };

  const csrfTokenService = { issue: vi.fn().mockReturnValue('csrf-token-1') } as unknown as CsrfTokenService;
  const policyStore = {
    getRequiredInteger: vi.fn().mockImplementation((key: string) => {
      const values: Record<string, number> = {
        'auth.session.idleTimeoutMinutes.student': 30,
        'auth.session.idleTimeoutMinutes.staff': 15,
      };
      return Promise.resolve(values[key]);
    }),
  } as unknown as PolicyStore;

  return { query: new GetSessionQuery(repository, sessionStore, csrfTokenService, policyStore), sessionStore, repository };
}

describe('GetSessionQuery', () => {
  it('returns null when there is no peekable session', async () => {
    const { query, sessionStore } = buildQuery();
    vi.mocked(sessionStore.peek).mockResolvedValue(null);
    await expect(query.execute('unknown')).resolves.toBeNull();
  });

  it('returns null when the account no longer exists or is not active', async () => {
    const { query } = buildQuery({ repository: { findAccountById: vi.fn().mockResolvedValue(null) } });
    await expect(query.execute('session-1')).resolves.toBeNull();
  });

  it('returns null when validateAndTouch rejects the session (e.g. it expired between peek and touch)', async () => {
    const { query, sessionStore } = buildQuery();
    vi.mocked(sessionStore.validateAndTouch).mockResolvedValue(null);
    await expect(query.execute('session-1')).resolves.toBeNull();
  });

  it('returns the snapshot with a fresh CSRF token and the touched expiry', async () => {
    const { query } = buildQuery();
    const snapshot = await query.execute('session-1');
    expect(snapshot).toEqual({
      userId: 'user-1',
      fullName: 'Nusrat Jahan',
      email: 'student@diu.edu.bd',
      roles: ['STU'],
      csrfToken: 'csrf-token-1',
      sessionExpiresAt: TOUCHED.expiresAt,
    });
  });

  it('touches with the staff (15 min) tier when a non-STU role is held', async () => {
    const { query, sessionStore } = buildQuery({
      repository: { loadActiveRoleCodes: vi.fn().mockResolvedValue(['ADM']) },
    });
    await query.execute('session-1');
    expect(sessionStore.validateAndTouch).toHaveBeenCalledWith('session-1', 15 * 60_000);
  });
});
