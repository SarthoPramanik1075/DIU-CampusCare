import { describe, expect, it } from 'vitest';

import { evaluatePasswordComplexity, isDiuInstitutionalEmail, isNonEmptyAfterTrim, isValidReason } from './validation.js';

describe('isDiuInstitutionalEmail — VR-01', () => {
  it('accepts a DIU institutional address', () => {
    expect(isDiuInstitutionalEmail('student@diu.edu.bd')).toBe(true);
  });

  it('accepts case-insensitively (citext column)', () => {
    expect(isDiuInstitutionalEmail('Student@DIU.EDU.BD')).toBe(true);
  });

  it('rejects a non-DIU domain', () => {
    expect(isDiuInstitutionalEmail('student@gmail.com')).toBe(false);
  });

  it('rejects a domain that merely contains diu.edu.bd as a substring', () => {
    expect(isDiuInstitutionalEmail('student@notdiu.edu.bd.evil.com')).toBe(false);
  });

  it('rejects a malformed address', () => {
    expect(isDiuInstitutionalEmail('not-an-email')).toBe(false);
  });
});

describe('evaluatePasswordComplexity — VR-02', () => {
  it('satisfies the policy at 10+ characters with three of four classes', () => {
    const result = evaluatePasswordComplexity('Abcdefgh1');
    expect(result.meetsMinimumLength).toBe(false); // 9 chars
    expect(evaluatePasswordComplexity('Abcdefgh12').satisfiesPolicy).toBe(true);
  });

  it('reports every criterion individually — API §1.8 "unmet criteria listed"', () => {
    const result = evaluatePasswordComplexity('short');
    expect(result).toMatchObject({
      meetsMinimumLength: false,
      hasLowercase: true,
      hasUppercase: false,
      hasDigit: false,
      hasSymbol: false,
      satisfiesPolicy: false,
    });
  });

  it('fails when the length is fine but fewer than three classes are met', () => {
    const result = evaluatePasswordComplexity('alllowercaseletters');
    expect(result.meetsMinimumLength).toBe(true);
    expect(result.satisfiesPolicy).toBe(false);
  });

  it('passes with exactly three of the four classes', () => {
    // lowercase + uppercase + digit, no symbol
    expect(evaluatePasswordComplexity('Abcdefghij1').satisfiesPolicy).toBe(true);
  });

  it('passes with all four classes', () => {
    expect(evaluatePasswordComplexity('Abcdefg1!2').satisfiesPolicy).toBe(true);
  });
});

describe('isNonEmptyAfterTrim — API §1.2 PATCH /me', () => {
  it('accepts a name with content', () => {
    expect(isNonEmptyAfterTrim('Nusrat Jahan Mim')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isNonEmptyAfterTrim('')).toBe(false);
  });

  it('rejects whitespace-only input', () => {
    expect(isNonEmptyAfterTrim('   \t\n  ')).toBe(false);
  });
});

describe('isValidReason — VR-93', () => {
  it('accepts a reason of at least 10 characters', () => {
    expect(isValidReason('Enrolment under review')).toBe(true);
  });

  it('rejects a reason under 10 characters', () => {
    expect(isValidReason('Too short')).toBe(false);
  });

  it('counts length after trimming', () => {
    expect(isValidReason('   short   ')).toBe(false);
  });

  it('rejects whitespace-only input regardless of raw length', () => {
    expect(isValidReason('              ')).toBe(false);
  });
});
