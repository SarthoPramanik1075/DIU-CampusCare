import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACTED_PATHS, REDACTION_CENSOR } from './redaction.js';

/**
 * The redaction behaviour is asserted against a raw pino instance sharing
 * `createLogger`'s config, writing to an in-memory sink, rather than against
 * `createLogger` itself — pino's own destination plumbing makes capturing
 * stdout in a unit test awkward, and the config object is what actually
 * carries the guarantee.
 */
function loggerWithSink() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ redact: { paths: [...REDACTED_PATHS], censor: REDACTION_CENSOR } }, sink);
  return { logger, lines };
}

describe('logging redaction', () => {
  it('redacts a password field wherever it appears', () => {
    const { logger, lines } = loggerWithSink();
    logger.info({ credentials: { email: 'a@b.com', password: 'hunter2' } }, 'login attempt');

    const [line] = lines;
    expect(line).toBeDefined();
    expect(line).not.toContain('hunter2');
    expect(line).toContain(REDACTION_CENSOR);
    expect(line).toContain('a@b.com'); // only the sensitive field is touched
  });

  it('redacts the Authorization and Cookie headers', () => {
    const { logger, lines } = loggerWithSink();
    logger.info(
      { req: { headers: { authorization: 'Bearer secret', cookie: 'ccc_session=abc', accept: 'json' } } },
      'request',
    );

    const [line] = lines;
    expect(line).toBeDefined();
    expect(line).not.toContain('Bearer secret');
    expect(line).not.toContain('ccc_session=abc');
    expect(line).toContain('json');
  });

  it('redacts a session cookie or token nested at any depth', () => {
    const { logger, lines } = loggerWithSink();
    logger.info({ session: { token: 'abc.def.ghi', userId: 'u1' } }, 'session created');

    const [line] = lines;
    expect(line).toBeDefined();
    expect(line).not.toContain('abc.def.ghi');
    expect(line).toContain('u1');
  });
});
