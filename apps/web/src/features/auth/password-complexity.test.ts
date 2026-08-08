import { describe, expect, it } from 'vitest';

import { evaluatePasswordComplexity } from './password-complexity.js';

describe('evaluatePasswordComplexity — VR-02', () => {
  it('reports every criterion individually', () => {
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

  it('is satisfied at 10+ characters with three of four classes', () => {
    expect(evaluatePasswordComplexity('Abcdefgh12').satisfiesPolicy).toBe(true);
  });

  it('fails when length is fine but fewer than three classes are met', () => {
    expect(evaluatePasswordComplexity('alllowercaseletters').satisfiesPolicy).toBe(false);
  });
});
