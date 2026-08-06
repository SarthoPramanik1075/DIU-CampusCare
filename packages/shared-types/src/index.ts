/**
 * `@campuscare/shared-types` — wire-format types shared by the Core
 * Application, the Counseling Service and the web client.
 *
 * ## What belongs here
 *
 * Only types that are genuinely neutral: the HTTP error envelope, role codes,
 * and primitive wire formats. Nothing else.
 *
 * ## What must never be added
 *
 * **No domain type from either service.** DR-3 (ARCHITECTURE §3.2) forbids the
 * Counseling module from importing anything belonging to a Core domain module
 * and vice versa. A shared package is the obvious place for that rule to be
 * quietly defeated — someone adds `Appointment` here "to avoid duplication",
 * and the boundary that ADR-001 exists to enforce is gone without anyone
 * editing a module.
 *
 * In particular this package must never contain: appointment, session, queue,
 * payment, medicine or inventory types from Core; and never any counseling
 * request, case, note, priority or triage type from the vault. Duplicating a
 * shape in two places is the cheaper mistake.
 *
 * The architecture suite asserts this (DR-3), so an addition of that kind
 * fails the build rather than review.
 */

export {
  UNIVERSAL_ERROR_CODES,
  isErrorResponse,
  type ErrorBody,
  type ErrorResponse,
  type FieldError,
  type UniversalErrorCode,
} from './error-envelope.js';

export {
  ROLE_CODES,
  ROLE_NAMES,
  isRoleCode,
  type AuthenticatedRoleCode,
  type RoleCode,
} from './roles.js';

export type { IsoDateString, IsoDateTimeString, LocalTimeString, Uuid } from './primitives.js';
