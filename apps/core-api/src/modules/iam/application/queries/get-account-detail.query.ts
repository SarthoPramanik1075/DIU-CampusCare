import type { AuditRecorder } from '../../../../kernel/audit/audit-recorder.js';
import type { AccountAdminRepository, AccountDetail } from '../account-admin-repository.js';

/**
 * `GET /api/v1/users/{id}` (API §1.3). Writes `audit.data_access_log` (not
 * `audit.audit_log` — this is a read, and DR-7's command-handler coverage
 * scanner only concerns `.handler.ts` files outside `queries/`) because an
 * Administrator reading another account is access to that person's data by
 * a non-owning user, which FR-AUD-03 requires to be logged regardless of
 * whether the read itself is authorized.
 */
export class GetAccountDetailQuery {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: { readonly userId: string; readonly accessorId: string; readonly correlationId: string }): Promise<AccountDetail | null> {
    const account = await this.repository.findAccountDetailById(input.userId);
    if (account === null) return null;

    await this.auditRecorder.recordDataAccess({
      accessorId: input.accessorId,
      subjectId: input.userId,
      dataCategory: 'identity.user_account',
      correlationId: input.correlationId,
    });

    return account;
  }
}
