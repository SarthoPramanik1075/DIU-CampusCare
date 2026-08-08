import { describe, expect, it } from 'vitest';

import { canDeactivate, isDeletable } from './doctor.js';

describe('isDeletable — EC-20', () => {
  it('permits deletion with zero appointment history', () => {
    expect(isDeletable(0)).toBe(true);
  });

  it('refuses deletion with any appointment history', () => {
    expect(isDeletable(1)).toBe(false);
    expect(isDeletable(214)).toBe(false);
  });
});

describe('canDeactivate — API §3.1 ALREADY_INACTIVE', () => {
  it('permits deactivating an active doctor', () => {
    expect(canDeactivate(true)).toBe(true);
  });

  it('refuses deactivating an already-inactive doctor', () => {
    expect(canDeactivate(false)).toBe(false);
  });
});
