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
  isNotInThePast,
  isValidPublicationWindowDays,
  isValidSlotLength,
  isValidTimeOrder,
  isValidUnavailabilityRange,
  isValidWalkInAllocation,
  requiresChangeReason,
} from './domain/validation.js';
