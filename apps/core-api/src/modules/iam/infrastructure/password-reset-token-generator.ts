import { createHash, randomBytes } from 'node:crypto';

const RAW_TOKEN_BYTES = 32;

export interface GeneratedResetToken {
  /** Goes in the emailed link — never stored. */
  readonly rawToken: string;
  /** What `identity.password_reset_token.token_hash` stores. */
  readonly tokenHash: string;
}

/**
 * FR-AUTH-08's reset token is high-entropy random data, not a low-entropy
 * secret a human chooses — a fast cryptographic hash (SHA-256) is the
 * correct tool here, unlike `PasswordHasher`'s deliberately slow Argon2id.
 * Only the hash is ever persisted (`000_AMENDMENTS.md` DDL-03), same
 * reasoning as `local_credential.password_hash`: a leaked database row
 * must not be a usable credential.
 */
export class PasswordResetTokenGenerator {
  generate(): GeneratedResetToken {
    const rawToken = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
    return { rawToken, tokenHash: this.hash(rawToken) };
  }

  hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
