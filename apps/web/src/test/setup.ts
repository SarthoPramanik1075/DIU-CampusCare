import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Testing Library's automatic per-test cleanup relies on a *global*
// `afterEach` (Jest-style). This workspace imports test functions from
// `vitest` explicitly rather than enabling `test.globals`, so that
// auto-registration never fires — without this, every render in a file
// accumulates in the same jsdom document and later queries see stale
// elements from earlier tests.
afterEach(() => {
  cleanup();
});

// jsdom (as of v25) declares `<dialog>`'s `showModal`/`close` in its type
// definitions but does not actually implement them at runtime — this test
// environment is always jsdom, so the polyfill always applies here.
// ConfirmDialog and the account-admin dialogs are built on the native
// element, so every component test that opens one needs this.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
