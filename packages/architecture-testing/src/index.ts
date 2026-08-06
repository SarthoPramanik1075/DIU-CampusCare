/**
 * `@campuscare/architecture-testing` — static-analysis primitives backing
 * the DR-1…DR-7 architecture test suite.
 *
 * Test-only. Nothing here is imported by either service's production code;
 * it exists to make ARCHITECTURE §3.2's dependency rules mechanically
 * checkable rather than a matter of code-review discipline.
 */
export { listSourceFiles, type ListSourceFilesOptions } from './source-files.js';
export { extractImports, resolveRelativeImport, type ImportSpecifier } from './imports.js';
export { findMutationCalls, type MutationCall } from './mutation-calls.js';
export { createFixture, type Fixture } from './fixtures.js';
