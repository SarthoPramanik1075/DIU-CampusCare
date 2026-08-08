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
  isValidPublicationWindowDays,
  isValidReason,
  isValidSlotLength,
  isValidTimeOrder,
  isValidUnavailabilityRange,
  isValidWalkInAllocation,
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
