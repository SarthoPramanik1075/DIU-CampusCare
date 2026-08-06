import { resolve } from 'node:path';

import { createFixture, extractImports, listSourceFiles } from '@campuscare/architecture-testing';
import { describe, expect, it } from 'vitest';

/**
 * DR-7 — ARCHITECTURE §3.2: "Every command handler records an audit entry."
 * Read models have nothing to audit; ARCHITECTURE.md's own counseling-api
 * example places query handlers under `application/queries/`, which is why
 * the one existing handler was moved there in this checkpoint (see
 * `list-active-announcements.query.ts`) — it is what makes "command handler"
 * structurally distinguishable from "query handler" at all.
 *
 * A command handler is any `application/*.handler.ts` file that is NOT
 * under `application/queries/`. Coverage is checked by import, not by
 * call-site AST matching: a handler that imports `AuditRecorder` has the
 * capability wired in via its constructor, which is the DI seam this
 * codebase uses everywhere (see `container.ts`).
 */
function findCommandHandlerFiles(applicationDir: string): string[] {
  return listSourceFiles(applicationDir, { includeTests: false }).filter(
    (file) => file.endsWith('.handler.ts') && !file.includes(`${resolve(applicationDir, 'queries')}/`),
  );
}

function findCommandHandlersMissingAudit(applicationDir: string): string[] {
  const violations: string[] = [];
  for (const file of findCommandHandlerFiles(applicationDir)) {
    const importsAuditRecorder = extractImports(file).some(({ specifier }) =>
      specifier.includes('audit-recorder'),
    );
    if (!importsAuditRecorder) {
      violations.push(file);
    }
  }
  return violations;
}

const MODULES_DIR = resolve(import.meta.dirname, '../../src/modules');

function allApplicationDirs(): string[] {
  return ['config'].map((name) => resolve(MODULES_DIR, name, 'application'));
}

describe('DR-7 · every command handler records an audit entry', () => {
  it('no command handler omits AuditRecorder', () => {
    for (const dir of allApplicationDirs()) {
      expect(findCommandHandlersMissingAudit(dir)).toEqual([]);
    }
  });

  it('there are currently zero command handlers (only the announcements query handler exists)', () => {
    // Documents *why* the real-code assertion above is not yet exercising
    // anything: M0.5 ships one query, no commands. The synthetic-fixture
    // tests below prove the rule still works even though real code cannot
    // yet violate it.
    const total = allApplicationDirs().flatMap((dir) => findCommandHandlerFiles(dir));
    expect(total).toEqual([]);
  });

  it('the scanner catches a command handler that never imports AuditRecorder', () => {
    const fixture = createFixture('dr7-violation');
    try {
      fixture.file(
        'application/create-appointment.handler.ts',
        `export class CreateAppointmentHandler {\n  async execute(): Promise<void> {}\n}\n`,
      );
      const violations = findCommandHandlersMissingAudit(resolve(fixture.root, 'application'));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('create-appointment.handler.ts');
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner passes a command handler that imports AuditRecorder', () => {
    const fixture = createFixture('dr7-clean');
    try {
      fixture.file(
        'application/create-appointment.handler.ts',
        `import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';\nexport class CreateAppointmentHandler {\n  constructor(private readonly audit: AuditRecorder) {}\n  async execute(): Promise<void> {}\n}\n`,
      );
      expect(findCommandHandlersMissingAudit(resolve(fixture.root, 'application'))).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('the scanner does not mistake a query handler for a command handler', () => {
    const fixture = createFixture('dr7-query-exempt');
    try {
      fixture.file(
        'application/queries/list-things.query.ts',
        `export class ListThingsHandler {\n  async execute(): Promise<readonly unknown[]> { return []; }\n}\n`,
      );
      // Not a .handler.ts file at all, and even if it were, it lives under
      // queries/ — either way it must not be flagged.
      expect(findCommandHandlerFiles(resolve(fixture.root, 'application'))).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
