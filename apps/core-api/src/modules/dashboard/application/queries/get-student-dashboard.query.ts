import type { Clock } from '../../../../kernel/clock/clock.js';
import { AuthorizationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ListActiveAnnouncementsHandler } from '../../../config/index.js';
import type { OwnProfileRepository } from '../../../iam/index.js';
import type { MedicineStoreState } from '../../domain/medicine-store.js';
import type { BookingSuspensionState, DashboardRepository } from '../dashboard-repository.js';

export interface StudentDashboardAnnouncement {
  readonly id: string;
  readonly body: string;
  readonly endsAt: Date;
}

export interface StudentDashboard {
  readonly student: { readonly fullName: string; readonly studentRef: string };
  /** Honestly empty — `queueing`/`scheduling` have no booking feature writing to them until M2. */
  readonly upcomingAppointments: readonly [];
  readonly todaysDoctors: readonly [];
  readonly medicineStore: MedicineStoreState;
  readonly notifications: { readonly unreadCount: number };
  readonly announcements: readonly StudentDashboardAnnouncement[];
  readonly bookingSuspension: BookingSuspensionState | null;
}

export function notAStudentError(): AuthorizationError {
  return new AuthorizationError({
    code: 'FORBIDDEN',
    message: 'This dashboard is only available to student accounts.',
    httpStatus: 403,
  });
}

/**
 * `GET /api/v1/me/dashboard` (API §2 DASH, FR-DASH-01…08). "Session + Own"
 * with no `userId` parameter (FR-AUTH-15, BR-02, PRM-03) — there is no
 * dedicated permission-matrix resource for this aggregation endpoint (it
 * is composed from several modules' own data, not a resource of its own),
 * so the route enforces plain `Session` and this query enforces the
 * "student" part itself, the same way FR-DASH-01 restricts the feature.
 */
export class GetStudentDashboardQuery {
  constructor(
    private readonly ownProfileRepository: Pick<OwnProfileRepository, 'findAccountById' | 'findStudentProfile'>,
    private readonly dashboardRepository: DashboardRepository,
    private readonly listActiveAnnouncements: ListActiveAnnouncementsHandler,
    private readonly clock: Clock,
  ) {}

  async execute(userId: string): Promise<Result<StudentDashboard, AuthorizationError>> {
    const [account, studentProfile] = await Promise.all([
      this.ownProfileRepository.findAccountById(userId),
      this.ownProfileRepository.findStudentProfile(userId),
    ]);
    if (account === null || studentProfile === null) return err(notAStudentError());

    const now = this.clock.now();
    const [medicineStore, bookingSuspension, unreadCount, announcements] = await Promise.all([
      this.dashboardRepository.findMedicineStoreState(now),
      this.dashboardRepository.findActiveBookingSuspension(userId, now),
      this.dashboardRepository.countUnreadNotifications(userId),
      this.listActiveAnnouncements.execute(),
    ]);

    return ok({
      student: { fullName: account.fullName, studentRef: studentProfile.studentRef },
      upcomingAppointments: [],
      todaysDoctors: [],
      medicineStore,
      notifications: { unreadCount },
      announcements: announcements.map((announcement) => ({ id: announcement.id, body: announcement.body, endsAt: announcement.endsAt })),
      bookingSuspension,
    });
  }
}
