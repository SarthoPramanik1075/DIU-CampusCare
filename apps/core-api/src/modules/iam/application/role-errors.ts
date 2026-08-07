import { AuthorizationError, ValidationError } from '../../../kernel/errors/domain-error.js';

/** VR-04 — shared between `POST /users` (`roles[]`) and `POST /users/{id}/roles` (`roleCode`); the field name differs by endpoint. */
export function roleNotAssignableError(field: string, reason: string): ValidationError {
  return new ValidationError({
    code: 'ROLE_NOT_ASSIGNABLE',
    message: 'The Counseling Professional role can only be given to an account marked as clinical staff.',
    fields: [{ field, rule: 'VR-04', message: reason }],
  });
}

export function roleNotHeldError(): AuthorizationError {
  return new AuthorizationError({
    code: 'ROLE_NOT_HELD',
    message: "This account doesn't have that role.",
    httpStatus: 404,
  });
}
