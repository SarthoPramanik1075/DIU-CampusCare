import { describe, expect, it } from 'vitest';

import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher — NFR-SEC-02', () => {
  it('produces an Argon2id-encoded hash, never the plaintext', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies the correct password', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(hash, 'wrong password')).toBe(false);
  });

  it('two hashes of the same password differ — per-credential salt', async () => {
    const hasher = new PasswordHasher();
    const [first, second] = await Promise.all([hasher.hash('same password'), hasher.hash('same password')]);
    expect(first).not.toBe(second);
  });

  it('treats a malformed hash as a non-match rather than throwing', async () => {
    const hasher = new PasswordHasher();
    await expect(hasher.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });
});
