import * as argon2 from 'argon2';

/**
 * NFR-SEC-02: "a current password-hashing function with a per-credential
 * salt. Plaintext or reversible storage is prohibited." Argon2id is the
 * OWASP-recommended default for new systems — memory-hard against GPU/ASIC
 * cracking, and the `argon2` package generates a fresh random salt per call
 * and embeds it in the encoded hash, so no salt column is needed on
 * `identity.local_credential` (`argon2.verify` reads it back out of the
 * stored string).
 *
 * A thin wrapper, not a direct `argon2` dependency in the application
 * layer, so a future algorithm change (or a verify-and-rehash upgrade
 * path) has exactly one place to happen.
 */
export class PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  async verify(hash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, candidate);
    } catch {
      // argon2.verify throws on a malformed/foreign hash string rather than
      // returning false — treated as "does not match" rather than an
      // infrastructure failure, since a corrupt hash and a wrong password
      // both mean the same thing to a caller: this login does not succeed.
      return false;
    }
  }
}
