import { describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';

import { LogoutHandler } from './logout.handler.js';

describe('LogoutHandler — FR-AUTH-07', () => {
  it('revokes the session and records an audit entry', async () => {
    const sessionStore = { revoke: vi.fn().mockResolvedValue(undefined) } as unknown as SessionStore;
    const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
    const handler = new LogoutHandler(sessionStore, auditRecorder);

    await handler.execute({ sessionId: 'session-1', userAccountId: 'user-1', correlationId: 'corr-1' });

    expect(sessionStore.revoke).toHaveBeenCalledWith('session-1');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'logout', actorId: 'user-1', entityId: 'session-1' }),
    );
  });
});
