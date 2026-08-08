/**
 * VR-02, mirrored client-side for a live checklist (P-08) — the server
 * (`apps/core-api/.../domain/validation.ts`) remains the authority and
 * re-validates on submit; this copy exists only so the five criteria can
 * update per keystroke without a round trip. Same shape, same rule:
 * minimum 10 characters, at least three of the four character classes.
 */
export interface PasswordComplexity {
  readonly meetsMinimumLength: boolean;
  readonly hasLowercase: boolean;
  readonly hasUppercase: boolean;
  readonly hasDigit: boolean;
  readonly hasSymbol: boolean;
  readonly satisfiesPolicy: boolean;
}

const MINIMUM_PASSWORD_LENGTH = 10;
const MINIMUM_CHARACTER_CLASSES = 3;

export function evaluatePasswordComplexity(password: string): PasswordComplexity {
  const meetsMinimumLength = password.length >= MINIMUM_PASSWORD_LENGTH;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);

  const classesMet = [hasLowercase, hasUppercase, hasDigit, hasSymbol].filter(Boolean).length;

  return {
    meetsMinimumLength,
    hasLowercase,
    hasUppercase,
    hasDigit,
    hasSymbol,
    satisfiesPolicy: meetsMinimumLength && classesMet >= MINIMUM_CHARACTER_CLASSES,
  };
}
