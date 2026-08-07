/**
 * Domain layer — DR-6. VR-01 and VR-02 as pure predicates, shared by the
 * backend's rejection logic and (via the same shape) the frontend's live
 * criteria checklist on P-08 — one evaluator, not two copies that could
 * drift apart.
 */

const DIU_EMAIL_PATTERN = /^[^\s@]+@diu\.edu\.bd$/i;

/** VR-01 — must match the DIU institutional domain format. */
export function isDiuInstitutionalEmail(email: string): boolean {
  return DIU_EMAIL_PATTERN.test(email.trim());
}

/**
 * VR-02 — minimum 10 characters, at least three of: lowercase, uppercase,
 * digit, symbol. Every criterion is reported individually, not just the
 * pass/fail: FRONTEND §10.1 (P-08) renders each as its own icon+text line,
 * and API §1.8 requires "the unmet criteria listed individually" in
 * `error.fields[]` on rejection.
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

/** API §1.2 `PATCH /me` — "Non-empty after trimming." */
export function isNonEmptyAfterTrim(value: string): boolean {
  return value.trim().length > 0;
}
