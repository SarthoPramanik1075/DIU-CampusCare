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
