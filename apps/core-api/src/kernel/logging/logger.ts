import pino, { type Logger, type LoggerOptions } from 'pino';

import { REDACTED_PATHS, REDACTION_CENSOR } from './redaction.js';

/**
 * The structured application-diagnostic stream — one of the three
 * independent streams of ARCHITECTURE §11.1. The other two are the general
 * audit trail (`kernel/audit`, backed by `audit.audit_log`) and the
 * counseling access log, which lives inside the vault and this service has
 * no credential to reach. Mixing any of the three into one stream is the
 * mistake §11.1 calls out by name; this logger is deliberately just the
 * first.
 */
export interface CreateLoggerOptions {
  readonly name: string;
  readonly level?: string;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    name: options.name,
    level: options.level ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACTED_PATHS], censor: REDACTION_CENSOR },
  };
  return pino(config);
}

/**
 * A no-op logger for tests that need to satisfy a constructor's dependency
 * without asserting on log output or printing to the test runner's console.
 */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
