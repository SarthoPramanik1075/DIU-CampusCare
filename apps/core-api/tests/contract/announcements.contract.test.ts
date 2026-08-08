import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { resolveAnonymousSubject } from '../../src/kernel/identity/subject-resolver.js';
import {
  ListActiveAnnouncementsHandler,
  type Announcement,
  type AnnouncementRepository,
} from '../../src/modules/config/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface AnnouncementDto {
  readonly id: string;
  readonly body: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface AnnouncementsSuccessBody {
  readonly items: readonly AnnouncementDto[];
}

interface ErrorEnvelopeBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
  };
}

/**
 * Contract test — API.md §2.5 `GET /api/v1/public/announcements`.
 *
 * Asserts the HTTP shape (status, headers, exact JSON keys) against the
 * spec, independent of the database — `tests/integration/announcement-
 * repository.test.ts` already proves the Kysely adapter against real
 * Postgres, so this file wires the real route through a fake, in-memory
 * `AnnouncementRepository` via Fastify's `.inject()`, no listening socket
 * and no database required.
 */
class InMemoryAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly announcements: readonly Announcement[]) {}

  findAll(): Promise<readonly Announcement[]> {
    return Promise.resolve(this.announcements);
  }
}

function buildTestApp(repository: AnnouncementRepository, now: Date): Promise<FastifyInstance> {
  const clock = new FixedClock(now);
  const listActiveAnnouncements = new ListActiveAnnouncementsHandler(repository, clock);

  const container: Container = {
    config: {
      nodeEnv: 'test',
      logLevel: 'silent',
      port: 0,
      databaseUrl: 'unused-in-this-test',
      webAppOrigin: 'http://localhost:5173',
      webAppOrigins: ['http://localhost:5173'],
      featureCounselingEnabled: false,
      featureEmailEnabled: false,
      sessionSecret: 'a'.repeat(32),
      sso: undefined,
    },
    // Nothing in this contract test's request path touches the database —
    // the announcements route is ANON-permitted, so the PEP never calls
    // `auditRecorder.recordDenial`, and its constructor does nothing eager
    // with the executor it is given. `error`/`info` are real no-ops (not
    // omitted) because `registerErrorHandling` calls them on the 500 path
    // exercised below — a logger stub missing them would throw from inside
    // the error handler itself and mask the real response behind Fastify's
    // own generic fallback.
    logger: { level: 'silent', error: () => undefined, info: () => undefined } as unknown as Container['logger'],
    db: undefined as unknown as Container['db'],
    clock,
    eventBus: undefined as unknown as Container['eventBus'],
    policyStore: undefined as unknown as Container['policyStore'],
    auditRecorder: new AuditRecorder(undefined as unknown as ConstructorParameters<typeof AuditRecorder>[0]),
    pdp: new PolicyDecisionPoint(),
    passwordHasher: undefined as unknown as Container['passwordHasher'],
    sessionStore: undefined as unknown as Container['sessionStore'],
    csrfTokenService: undefined as unknown as Container['csrfTokenService'],
    // The announcements route is ANON-permitted, but the PEP still calls
    // this on every request — unlike the auth-route handlers below, it
    // must be a real, callable function, not a placeholder cast.
    resolveSubject: () => Promise.resolve(resolveAnonymousSubject()),
    listActiveAnnouncements,
    loginWithPassword: undefined as unknown as Container['loginWithPassword'],
    logout: undefined as unknown as Container['logout'],
    getSession: undefined as unknown as Container['getSession'],
    ssoLogin: undefined as unknown as Container['ssoLogin'],
    ssoCallback: undefined as unknown as Container['ssoCallback'],
    requestPasswordReset: undefined as unknown as Container['requestPasswordReset'],
    confirmPasswordReset: undefined as unknown as Container['confirmPasswordReset'],
    getOwnProfile: undefined as unknown as Container['getOwnProfile'],
    updateOwnProfile: undefined as unknown as Container['updateOwnProfile'],
    listAccounts: undefined as unknown as Container['listAccounts'],
    getAccountDetail: undefined as unknown as Container['getAccountDetail'],
    createAccount: undefined as unknown as Container['createAccount'],
    updateAccountAdmin: undefined as unknown as Container['updateAccountAdmin'],
    suspendAccount: undefined as unknown as Container['suspendAccount'],
    activateAccount: undefined as unknown as Container['activateAccount'],
    deactivateAccount: undefined as unknown as Container['deactivateAccount'],
    listRoleCatalogue: undefined as unknown as Container['listRoleCatalogue'],
    grantRole: undefined as unknown as Container['grantRole'],
    revokeRole: undefined as unknown as Container['revokeRole'],
    getStudentDashboard: undefined as unknown as Container['getStudentDashboard'],
    listDoctors: undefined as unknown as Container['listDoctors'],
    getDoctor: undefined as unknown as Container['getDoctor'],
    createDoctor: undefined as unknown as Container['createDoctor'],
    updateDoctor: undefined as unknown as Container['updateDoctor'],
    deactivateDoctor: undefined as unknown as Container['deactivateDoctor'],
    deleteDoctor: undefined as unknown as Container['deleteDoctor'],
    listDutyRosters: undefined as unknown as Container['listDutyRosters'],
    createDutyRoster: undefined as unknown as Container['createDutyRoster'],
    updateDutyRoster: undefined as unknown as Container['updateDutyRoster'],
    deleteDutyRoster: undefined as unknown as Container['deleteDutyRoster'],
  };

  return buildApp(container);
}

describe('GET /api/v1/public/announcements — contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with an empty items array and the edge-cache header when there are no announcements', async () => {
    app = await buildTestApp(new InMemoryAnnouncementRepository([]), new Date('2026-08-06T00:00:00+06:00'));

    const response = await app.inject({ method: 'GET', url: '/api/v1/public/announcements' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.json<AnnouncementsSuccessBody>()).toEqual({ items: [] });
  });

  it('returns exactly the documented fields for an active announcement — API §2.5', async () => {
    const now = new Date('2026-08-06T12:00:00+06:00');
    const repository = new InMemoryAnnouncementRepository([
      {
        id: '0191f5aa-0000-7000-8000-000000000001',
        body: 'The medical centre will close at 1 PM on 12 August for a staff training day.',
        startsAt: new Date('2026-08-01T00:00:00+06:00'),
        endsAt: new Date('2026-08-12T23:59:00+06:00'),
      },
    ]);
    app = await buildTestApp(repository, now);

    const response = await app.inject({ method: 'GET', url: '/api/v1/public/announcements' });
    const body = response.json<AnnouncementsSuccessBody>();

    expect(response.statusCode).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0]!).sort()).toEqual(['body', 'endsAt', 'id', 'startsAt']);
    expect(body.items[0]).toEqual({
      id: '0191f5aa-0000-7000-8000-000000000001',
      body: 'The medical centre will close at 1 PM on 12 August for a staff training day.',
      startsAt: '2026-08-01T00:00:00+06:00',
      endsAt: '2026-08-12T23:59:00+06:00',
    });
    // API §0.8: "Timestamps ... always +06:00." Never a bare `Z` UTC suffix.
    expect(body.items[0]!.startsAt).toMatch(/\+06:00$/);
  });

  it('omits an announcement whose window has not started or has already ended', async () => {
    const now = new Date('2026-08-06T12:00:00+06:00');
    const repository = new InMemoryAnnouncementRepository([
      {
        id: '0191f5aa-0000-7000-8000-000000000002',
        body: 'Expired already.',
        startsAt: new Date('2026-01-01T00:00:00+06:00'),
        endsAt: new Date('2026-01-02T00:00:00+06:00'),
      },
    ]);
    app = await buildTestApp(repository, now);

    const response = await app.inject({ method: 'GET', url: '/api/v1/public/announcements' });
    expect(response.json<AnnouncementsSuccessBody>()).toEqual({ items: [] });
  });

  it('an unhandled failure returns the uniform error envelope — API §0.4', async () => {
    const failingRepository: AnnouncementRepository = {
      findAll: () => Promise.reject(new Error('connection refused')),
    };
    app = await buildTestApp(failingRepository, new Date());

    const response = await app.inject({ method: 'GET', url: '/api/v1/public/announcements' });
    const body = response.json<ErrorEnvelopeBody>();

    expect(response.statusCode).toBe(500);
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(typeof body.error.correlationId).toBe('string');
    // NFR-SEC-07: never leak the underlying error's own message.
    expect(JSON.stringify(body)).not.toContain('connection refused');
  });
});
