export interface CreateResetTokenInput {
  readonly userAccountId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface ValidResetToken {
  readonly id: string;
  readonly userAccountId: string;
}

/**
 * Port for `identity.password_reset_token` (DDL-03) and the one
 * `local_credential` write password reset makes — kept separate from
 * `AuthenticationRepository` (which the request handler still uses for
 * `findAccountWithCredentialByEmail`) because this is a distinct table with
 * its own lifecycle, not more login/session plumbing.
 */
export interface PasswordResetRepository {
  createToken(input: CreateResetTokenInput): Promise<void>;
  /** `null` for an unknown, expired, or already-consumed token — API §1.8 collapses all three into `RESET_TOKEN_INVALID`. */
  findValidToken(tokenHash: string, now: Date): Promise<ValidResetToken | null>;
  consumeToken(tokenId: string, now: Date): Promise<void>;
  updatePasswordHash(userAccountId: string, newPasswordHash: string, now: Date): Promise<void>;
}
