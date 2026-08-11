import type { Clock } from '../../../../kernel/clock/clock.js';
import type { AppointmentListScope, AppointmentRepository, MyAppointmentListItem } from '../appointment-repository.js';

const DEFAULT_LIMIT = 50;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `GET /api/v1/me/appointments` (API §4.1, S-06). */
export class ListMyAppointmentsQuery {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(studentId: string, scope: AppointmentListScope, limit: number | undefined): Promise<readonly MyAppointmentListItem[]> {
    return this.repository.listMyAppointments(studentId, scope, toIsoDate(this.clock.now()), limit ?? DEFAULT_LIMIT);
  }
}
