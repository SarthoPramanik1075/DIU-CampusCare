import { AuthorizationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ClinicSessionListItem, ClinicSessionRepository, QueueSummary } from '../clinic-session-repository.js';

export type ClinicSessionDetail = ClinicSessionListItem & { readonly queueSummary: QueueSummary };

/** `GET /api/v1/sessions/{id}` (API §3.3) — the list-item shape plus an aggregate `queueSummary`, honestly all-zero until M3 books appointments. */
export class GetClinicSessionQuery {
  constructor(private readonly repository: ClinicSessionRepository) {}

  async execute(sessionId: string): Promise<Result<ClinicSessionDetail, AuthorizationError>> {
    const session = await this.repository.findClinicSessionById(sessionId);
    if (session === null) {
      return err(new AuthorizationError({ code: 'NOT_FOUND', message: 'That session could not be found.', httpStatus: 404 }));
    }
    const queueSummary = await this.repository.getQueueSummary(sessionId);
    return ok({ ...session, queueSummary });
  }
}
