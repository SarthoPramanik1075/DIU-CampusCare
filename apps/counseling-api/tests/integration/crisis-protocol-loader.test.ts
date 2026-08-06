import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCrisisProtocol } from '../../src/kernel/crisis-protocol/loader.js';

/**
 * BR-68 / EC-48 — the deployment gate. Fixtures are built in a scratch
 * temp directory per test rather than checked into
 * `content/crisis-protocol/`, which stays genuinely empty in this
 * repository (see its README) so the shipped default matches reality: this
 * content does not exist yet.
 */
describe('loadCrisisProtocol', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crisis-protocol-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when protocol.json does not exist at all', () => {
    expect(() => loadCrisisProtocol(dir)).toThrow(/refuses to start/);
  });

  it('throws when protocol.json is not valid JSON', () => {
    writeFileSync(join(dir, 'protocol.json'), '{ not valid json');
    expect(() => loadCrisisProtocol(dir)).toThrow(/not valid JSON/);
  });

  it('throws when protocolVersion is missing', () => {
    writeFileSync(join(dir, 'protocol.json'), JSON.stringify({ someOtherField: 'x' }));
    expect(() => loadCrisisProtocol(dir)).toThrow(/protocolVersion/);
  });

  it('throws when protocolVersion is present but empty', () => {
    writeFileSync(join(dir, 'protocol.json'), JSON.stringify({ protocolVersion: '   ' }));
    expect(() => loadCrisisProtocol(dir)).toThrow(/non-empty/);
  });

  it('throws when protocolVersion is not a string', () => {
    writeFileSync(join(dir, 'protocol.json'), JSON.stringify({ protocolVersion: 42 }));
    expect(() => loadCrisisProtocol(dir)).toThrow(/non-empty/);
  });

  it('returns the manifest when protocol.json is present and valid', () => {
    writeFileSync(join(dir, 'protocol.json'), JSON.stringify({ protocolVersion: 'DIU-CP-01-r1' }));
    expect(loadCrisisProtocol(dir)).toEqual({ protocolVersion: 'DIU-CP-01-r1' });
  });

  // The property that actually matters: the real, shipped content
  // directory has no protocol.json, so the gate fires against it exactly
  // as it will in a real deployment before DIU delivers the content.
  it('refuses to start against the real, currently-empty content directory', () => {
    const realContentDir = new URL('../../content/crisis-protocol', import.meta.url).pathname;
    expect(() => loadCrisisProtocol(realContentDir)).toThrow(/refuses to start/);
  });
});
