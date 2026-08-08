/**
 * The scheduling module's public interface — DR-2. The only legal
 * cross-module import surface; every other module reaches this module's
 * behaviour only through what is exported here.
 */
export { seedSchedulingPolicies } from './bootstrap.js';
export { canCancel, canComplete, canEditTimes, canInterrupt, canStart, type SessionStatus } from './domain/clinic-session.js';
export { canDeactivate, isDeletable } from './domain/doctor.js';
export { deriveSlots, type DerivedSlot, type SlotDerivationInput, type SlotDerivationResult } from './domain/slot-derivation.js';
export {
  isAtLeastOneSlot,
  isNonEmptyAfterTrim,
  isNotInThePast,
  isValidEffectiveRange,
  isValidLocalTimeOrder,
  isValidPublicationWindowDays,
  isValidReason,
  isValidSlotLength,
  isValidTimeOrder,
  isValidUnavailabilityRange,
  isValidWalkInAllocation,
  isValidWeekday,
  requiresChangeReason,
} from './domain/validation.js';

export type {
  CreateDoctorInput,
  CreateDoctorResult,
  DeactivateDoctorOutcome,
  DeleteDoctorOutcome,
  DoctorDetail,
  DoctorListFilter,
  DoctorListItem,
  DoctorListPage,
  DoctorRepository,
  UpdateDoctorInput,
  UpdateDoctorOutcome,
} from './application/doctor-repository.js';
export { CreateDoctorHandler, type CreateDoctorCommandInput } from './application/create-doctor.handler.js';
export { UpdateDoctorHandler, doctorNotFoundError, type UpdateDoctorCommandInput } from './application/update-doctor.handler.js';
export { DeactivateDoctorHandler, type DeactivateDoctorInput, type DeactivateDoctorResult } from './application/deactivate-doctor.handler.js';
export { DeleteDoctorHandler, type DeleteDoctorInput } from './application/delete-doctor.handler.js';
export { GetDoctorQuery } from './application/queries/get-doctor.query.js';
export { ListDoctorsQuery, type ListDoctorsInput } from './application/queries/list-doctors.query.js';
export { KyselyDoctorRepository } from './infrastructure/doctor.repository.js';
export { registerDoctorRoutes, type DoctorRouteDeps } from './interface/http/doctor.routes.js';

export type {
  CreateDutyRosterInput,
  CreateDutyRosterResult,
  DeleteDutyRosterOutcome,
  DutyRoster,
  DutyRosterListFilter,
  DutyRosterRepository,
  UpdateDutyRosterInput,
  UpdateDutyRosterOutcome,
} from './application/duty-roster-repository.js';
export { CreateDutyRosterHandler, doctorNotFoundForRosterError, type CreateDutyRosterCommandInput } from './application/create-duty-roster.handler.js';
export { UpdateDutyRosterHandler, dutyRosterNotFoundError, type UpdateDutyRosterCommandInput } from './application/update-duty-roster.handler.js';
export { DeleteDutyRosterHandler, type DeleteDutyRosterInput } from './application/delete-duty-roster.handler.js';
export { ListDutyRostersQuery } from './application/queries/list-duty-rosters.query.js';
export { KyselyDutyRosterRepository } from './infrastructure/duty-roster.repository.js';
export { registerDutyRosterRoutes, type DutyRosterRouteDeps } from './interface/http/duty-roster.routes.js';

export type {
  ClinicSessionListFilter,
  ClinicSessionListItem,
  ClinicSessionRepository,
  CreateClinicSessionInput,
  CreateClinicSessionResult,
  QueueSummary,
  ServiceCalendarClosure,
  SessionSlotItem,
  UpdateClinicSessionInput,
  UpdateClinicSessionOutcome,
} from './application/clinic-session-repository.js';
export { CreateClinicSessionHandler, doctorNotFoundForSessionError, type CreateClinicSessionCommandInput } from './application/create-clinic-session.handler.js';
export { UpdateClinicSessionHandler, clinicSessionNotFoundError, type UpdateClinicSessionCommandInput } from './application/update-clinic-session.handler.js';
export { GetClinicSessionQuery, type ClinicSessionDetail } from './application/queries/get-clinic-session.query.js';
export { ListClinicSessionsQuery } from './application/queries/list-clinic-sessions.query.js';
export { GetSessionSlotsQuery, type SessionSlotsResult } from './application/queries/get-session-slots.query.js';
export { KyselyClinicSessionRepository } from './infrastructure/clinic-session.repository.js';
export { registerClinicSessionRoutes, type ClinicSessionRouteDeps } from './interface/http/clinic-session.routes.js';
