/**
 * The queueing module's public interface — DR-2. The only legal
 * cross-module import surface; every other module reaches this module's
 * behaviour only through what is exported here.
 */
export { seedQueueingPolicies } from './bootstrap.js';

export {
  canAdvanceTo,
  canCancel,
  canCheckIn,
  canMarkNoShow,
  canReverseTo,
  isTerminal,
  permittedTransitions,
  type AppointmentStatus,
  type PermittedTransitions,
} from './domain/appointment-status.js';
export { compareQueueOrder, orderQueue, type QueueOrderable } from './domain/queue-ordering.js';
export {
  classifyCancellation,
  hasGracePeriodElapsed,
  isBeforeBookingCutoff,
  isBelowMaxActiveBookings,
  isSlotInFuture,
  isUnderActiveSuspension,
  isValidVisitReasonNote,
  isWithinPublicationWindow,
  remainingGracePeriodSeconds,
  type CancellationClassification,
} from './domain/booking-validation.js';
export {
  computeMeanConsultationDurationMinutes,
  estimateForPosition,
  filterAnomalousDurations,
  hasEstimateSlipped,
  shouldNotifySlip,
} from './domain/estimation.js';
export { formatAppointmentRef } from './domain/appointment-ref.js';

export {
  ACTIVE_BOOKING_STATUSES,
  type ActiveSuspension,
  type AppointmentDetail,
  type AppointmentListScope,
  type AppointmentRepository,
  type AvailableSlotItem,
  type BookedAppointment,
  type CancelAppointmentOutcome,
  type CancelledAppointment,
  type CreateBookingInput,
  type CreateBookingOutcome,
  type MyAppointmentListItem,
  type QueueEntrySummary,
  type ServiceCalendarClosure,
  type SlotBookingContext,
} from './application/appointment-repository.js';
export { BookAppointmentHandler, type BookAppointmentCommandInput } from './application/book-appointment.handler.js';
export { appointmentNotFoundError, CancelAppointmentHandler, type CancelAppointmentCommandInput } from './application/cancel-appointment.handler.js';
export { GetAvailabilityQuery, type AvailabilitySessionItem } from './application/queries/get-availability.query.js';
export { GetAppointmentDetailQuery, type AppointmentViewer, type AppointmentViewerRole } from './application/queries/get-appointment-detail.query.js';
export { GetQueuePositionQuery, type QueuePositionResult } from './application/queries/get-queue-position.query.js';
export { ListMyAppointmentsQuery } from './application/queries/list-my-appointments.query.js';
export { KyselyAppointmentRepository } from './infrastructure/appointment.repository.js';
export { registerAppointmentRoutes, type AppointmentRouteDeps } from './interface/http/appointment.routes.js';
