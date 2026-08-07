/**
 * The dashboard module's public interface — DR-2. A pure read-composition
 * module: it owns no table of its own (DATABASE.md has no `dashboard`
 * schema) and exists because `GET /me/dashboard` (API §2 DASH) aggregates
 * data other modules own — `iam` (student profile) and `config`
 * (announcements) via their own public barrels, plus the two tables below
 * that no other module's port yet covers.
 */
export { computeMedicineStoreState, type MedicineStoreState, type ScheduledHours, type StatusOverride } from './domain/medicine-store.js';
export type { BookingSuspensionState, DashboardRepository } from './application/dashboard-repository.js';
export {
  GetStudentDashboardQuery,
  notAStudentError,
  type StudentDashboard,
  type StudentDashboardAnnouncement,
} from './application/queries/get-student-dashboard.query.js';
export { KyselyDashboardRepository } from './infrastructure/dashboard.repository.js';
export { registerDashboardRoutes, type DashboardRouteDeps } from './interface/http/dashboard.routes.js';
