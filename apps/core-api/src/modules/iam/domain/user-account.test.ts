import { describe, expect, it } from 'vitest';

import { canActivate, canDeactivate, canSuspend, type AccountStatus } from './user-account.js';

const ALL_STATUSES: readonly AccountStatus[] = ['pending', 'active', 'suspended', 'deactivated'];

describe('canSuspend — API §1.15', () => {
  it('permits suspension from active or pending', () => {
    expect(canSuspend('active')).toBe(true);
    expect(canSuspend('pending')).toBe(true);
  });

  it('refuses suspension from suspended or deactivated', () => {
    expect(canSuspend('suspended')).toBe(false);
    expect(canSuspend('deactivated')).toBe(false);
  });
});

describe('canActivate — API §1.16', () => {
  it('permits activation from anything except already-active', () => {
    for (const status of ALL_STATUSES) {
      expect(canActivate(status)).toBe(status !== 'active');
    }
  });

  it('explicitly permits reactivating a deactivated account', () => {
    expect(canActivate('deactivated')).toBe(true);
  });
});

describe('canDeactivate — API §1.17', () => {
  it('permits deactivation from anything except already-deactivated', () => {
    for (const status of ALL_STATUSES) {
      expect(canDeactivate(status)).toBe(status !== 'deactivated');
    }
  });
});
