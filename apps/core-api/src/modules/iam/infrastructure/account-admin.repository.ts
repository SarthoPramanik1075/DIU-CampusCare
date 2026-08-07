import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  AccountAdminRepository,
  AccountDetail,
  AccountListFilter,
  AccountListItem,
  AccountListPage,
  ActiveAppointmentSummary,
  CreateAccountInput,
  CreateAccountResult,
  GrantRoleInput,
  GrantRoleOutcome,
  RevokeRoleInput,
  RevokeRoleOutcome,
  RoleCatalogueEntry,
  TransitionStatusInput,
  TransitionStatusOutcome,
  UpdateAccountAdminInput,
  UpdateAccountAdminOutcome,
} from '../application/account-admin-repository.js';
import { isRoleAssignableByAdmin, roleRequiresClinicalStaff } from '../domain/role.js';

/** Postgres `unique_violation` — the only realistic race this insert can hit (the citext `email` column). */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === PG_UNIQUE_VIOLATION;
}

/** Statuses that still occupy an appointment slot — API §1.3 VR-05's "active bookings". */
const ACTIVE_APPOINTMENT_STATUSES = ['booked', 'checked_in', 'waiting', 'in_consultation'] as const;

export class KyselyAccountAdminRepository implements AccountAdminRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listAccounts(filter: AccountListFilter): Promise<AccountListPage> {
    let query = this.db
      .selectFrom('identity.user_account')
      .leftJoin('identity.student_profile', 'identity.student_profile.user_account_id', 'identity.user_account.id')
      .select([
        'identity.user_account.id',
        'identity.user_account.email',
        'identity.user_account.full_name',
        'identity.user_account.status',
        'identity.user_account.created_at',
        'identity.user_account.version',
        'identity.student_profile.student_ref',
      ]);

    if (filter.q !== undefined) {
      const pattern = `%${filter.q}%`;
      query = query.where((eb) =>
        eb.or([
          eb('identity.user_account.full_name', 'ilike', pattern),
          eb('identity.user_account.email', 'ilike', pattern),
          eb('identity.student_profile.student_ref', 'ilike', pattern),
        ]),
      );
    }
    if (filter.status !== undefined) {
      query = query.where('identity.user_account.status', '=', filter.status);
    }
    if (filter.cursor !== undefined) {
      query = query.where('identity.user_account.id', '>', filter.cursor);
    }
    if (filter.role !== undefined) {
      query = query.where(
        'identity.user_account.id',
        'in',
        this.db
          .selectFrom('identity.user_role')
          .innerJoin('identity.role', 'identity.role.id', 'identity.user_role.role_id')
          .select('identity.user_role.user_account_id')
          .where('identity.role.code', '=', filter.role)
          .where('identity.user_role.revoked_at', 'is', null),
      );
    }

    const rows = await query
      .orderBy('identity.user_account.id')
      .limit(filter.limit + 1)
      .execute();
    const hasMore = rows.length > filter.limit;
    const pageRows = hasMore ? rows.slice(0, filter.limit) : rows;

    const rolesByAccount = await this.loadRolesForAccounts(pageRows.map((row) => row.id));

    const items: AccountListItem[] = pageRows.map((row) => ({
      userId: row.id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      roles: rolesByAccount.get(row.id) ?? [],
      studentRef: row.student_ref,
      createdAt: row.created_at,
      version: row.version,
    }));

    const lastRow = pageRows.at(-1);
    return { items, nextCursor: hasMore && lastRow !== undefined ? lastRow.id : null };
  }

  private async loadRolesForAccounts(userAccountIds: readonly string[]): Promise<Map<string, AuthenticatedRoleCode[]>> {
    const map = new Map<string, AuthenticatedRoleCode[]>();
    if (userAccountIds.length === 0) return map;

    const rows = await this.db
      .selectFrom('identity.user_role')
      .innerJoin('identity.role', 'identity.role.id', 'identity.user_role.role_id')
      .select(['identity.user_role.user_account_id', 'identity.role.code'])
      .where('identity.user_role.user_account_id', 'in', userAccountIds)
      .where('identity.user_role.revoked_at', 'is', null)
      .execute();

    for (const row of rows) {
      const existing = map.get(row.user_account_id);
      if (existing === undefined) map.set(row.user_account_id, [row.code]);
      else existing.push(row.code);
    }
    return map;
  }

  async findAccountDetailById(userId: string): Promise<AccountDetail | null> {
    const row = await this.db
      .selectFrom('identity.user_account')
      .leftJoin('identity.local_credential', 'identity.local_credential.user_account_id', 'identity.user_account.id')
      .leftJoin('identity.student_profile', 'identity.student_profile.user_account_id', 'identity.user_account.id')
      .select([
        'identity.user_account.id',
        'identity.user_account.email',
        'identity.user_account.full_name',
        'identity.user_account.status',
        'identity.user_account.is_clinical_staff',
        'identity.user_account.version',
        'identity.local_credential.user_account_id as credential_account_id',
        'identity.local_credential.locked_until',
        'identity.student_profile.student_ref',
        'identity.student_profile.programme',
        'identity.student_profile.is_enrolled',
      ])
      .where('identity.user_account.id', '=', userId)
      .executeTakeFirst();
    if (row === undefined) return null;

    const [roles, lastLoginRow] = await Promise.all([
      this.db
        .selectFrom('identity.user_role')
        .innerJoin('identity.role', 'identity.role.id', 'identity.user_role.role_id')
        .select(['identity.role.code', 'identity.user_role.granted_by', 'identity.user_role.granted_at'])
        .where('identity.user_role.user_account_id', '=', userId)
        .where('identity.user_role.revoked_at', 'is', null)
        .execute(),
      this.db
        .selectFrom('identity.login_attempt')
        .select(({ fn }) => fn.max('attempted_at').as('last_login_at'))
        .where('user_account_id', '=', userId)
        .where('succeeded', '=', true)
        .executeTakeFirst(),
    ]);

    return {
      userId: row.id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      authMethod: row.credential_account_id === null ? 'sso' : 'local',
      roles: roles.map((role) => ({ code: role.code, grantedBy: role.granted_by, grantedAt: role.granted_at })),
      // The left join makes every student_profile column nullable to the
      // type checker, but `is_enrolled` is NOT NULL in the schema — it can
      // only be genuinely absent in lockstep with `student_ref`, already
      // handled by the ternary itself; `?? true` matches the column's own
      // DB default and is never actually exercised.
      studentProfile:
        row.student_ref === null
          ? null
          : { studentRef: row.student_ref, programme: row.programme, isEnrolled: row.is_enrolled ?? true },
      lockedUntil: row.locked_until,
      lastLoginAt: lastLoginRow?.last_login_at ?? null,
      isClinicalStaff: row.is_clinical_staff,
      version: row.version,
    };
  }

  async isEmailRegistered(email: string): Promise<boolean> {
    const row = await this.db.selectFrom('identity.user_account').select('id').where('email', '=', email).executeTakeFirst();
    return row !== undefined;
  }

  async createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
    let accountId: string;
    try {
      accountId = await this.db.transaction().execute(async (trx) => {
        const id = uuidv7();
        await trx
          .insertInto('identity.user_account')
          .values({
            id,
            email: input.email,
            full_name: input.fullName,
            location_id: input.locationId,
            created_by: input.createdBy,
            is_clinical_staff: input.isClinicalStaff,
          })
          .execute();

        if (input.passwordHash !== null) {
          await trx.insertInto('identity.local_credential').values({ user_account_id: id, password_hash: input.passwordHash }).execute();
        }

        const roleRows = await trx.selectFrom('identity.role').select(['id']).where('code', 'in', input.roles).execute();
        for (const roleRow of roleRows) {
          await trx
            .insertInto('identity.user_role')
            .values({ id: uuidv7(), user_account_id: id, role_id: roleRow.id, granted_by: input.createdBy })
            .execute();
        }

        return id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { outcome: 'email_taken' };
      throw error;
    }

    const account = await this.findAccountDetailById(accountId);
    if (account === null) {
      throw new Error(`identity.user_account ${accountId} vanished immediately after its own creation`);
    }
    return { outcome: 'created', account };
  }

  async updateAccountAdmin(input: UpdateAccountAdminInput): Promise<UpdateAccountAdminOutcome> {
    const row = await this.db
      .updateTable('identity.user_account')
      .set((eb) => ({
        ...(input.fullName === undefined ? {} : { full_name: input.fullName }),
        ...(input.isClinicalStaff === undefined ? {} : { is_clinical_staff: input.isClinicalStaff }),
        ...(input.locationId === undefined ? {} : { location_id: input.locationId }),
        version: eb('version', '+', 1),
        updated_at: input.now,
      }))
      .where('id', '=', input.userId)
      .where('version', '=', input.expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const exists = await this.db.selectFrom('identity.user_account').select('id').where('id', '=', input.userId).executeTakeFirst();
      return exists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const account = await this.findAccountDetailById(row.id);
    if (account === null) throw new Error(`identity.user_account ${row.id} vanished immediately after its own update`);
    return { outcome: 'updated', account };
  }

  async transitionStatus(input: TransitionStatusInput): Promise<TransitionStatusOutcome> {
    const row = await this.db
      .updateTable('identity.user_account')
      .set((eb) => ({ status: input.newStatus, version: eb('version', '+', 1), updated_at: input.now }))
      .where('id', '=', input.userId)
      .where('version', '=', input.expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const exists = await this.db.selectFrom('identity.user_account').select('id').where('id', '=', input.userId).executeTakeFirst();
      return exists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const account = await this.findAccountDetailById(row.id);
    if (account === null) throw new Error(`identity.user_account ${row.id} vanished immediately after its own update`);
    return { outcome: 'transitioned', account };
  }

  async findActiveAppointmentsForStudent(userId: string): Promise<readonly ActiveAppointmentSummary[]> {
    const rows = await this.db
      .selectFrom('queueing.appointment')
      .innerJoin('scheduling.clinic_session', 'scheduling.clinic_session.id', 'queueing.appointment.clinic_session_id')
      .innerJoin('scheduling.doctor', 'scheduling.doctor.id', 'scheduling.clinic_session.doctor_id')
      .select([
        'queueing.appointment.appointment_ref',
        'scheduling.clinic_session.session_date',
        'scheduling.doctor.full_name as doctor_name',
      ])
      .where('queueing.appointment.student_id', '=', userId)
      .where('queueing.appointment.status', 'in', ACTIVE_APPOINTMENT_STATUSES)
      .execute();

    return rows.map((row) => ({ appointmentRef: row.appointment_ref, sessionDate: row.session_date, doctorName: row.doctor_name }));
  }

  async listRoleCatalogue(): Promise<readonly RoleCatalogueEntry[]> {
    const rows = await this.db.selectFrom('identity.role').select(['code', 'name']).orderBy('code').execute();
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      assignableByAdmin: isRoleAssignableByAdmin(row.code),
      requiresClinicalStaff: roleRequiresClinicalStaff(row.code),
    }));
  }

  async grantRole(input: GrantRoleInput): Promise<GrantRoleOutcome> {
    const account = await this.db.selectFrom('identity.user_account').select('id').where('id', '=', input.userId).executeTakeFirst();
    if (account === undefined) return { outcome: 'not_found' };

    const roleRow = await this.db
      .selectFrom('identity.role')
      .select('id')
      .where('code', '=', input.roleCode)
      .executeTakeFirstOrThrow(() => new Error(`identity.role has no ${input.roleCode} row — has 006_iam_extensions.sql been migrated?`));

    const existingActiveGrant = await this.db
      .selectFrom('identity.user_role')
      .select('id')
      .where('user_account_id', '=', input.userId)
      .where('role_id', '=', roleRow.id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (existingActiveGrant !== undefined) return { outcome: 'already_held' };

    try {
      await this.db
        .insertInto('identity.user_role')
        .values({ id: uuidv7(), user_account_id: input.userId, role_id: roleRow.id, granted_by: input.grantedBy })
        .execute();
    } catch (error) {
      // UQ-01 (`000_AMENDMENTS.md`): `uq_user_role` has no `WHERE revoked_at
      // IS NULL` scoping, so re-granting a role this account held and lost
      // hits the same unique constraint as a genuine duplicate. Reporting
      // it as `already_held` is honest about the symptom even though the
      // underlying reason differs in that revoked-row case.
      if (isUniqueViolation(error)) return { outcome: 'already_held' };
      throw error;
    }

    const updated = await this.findAccountDetailById(input.userId);
    if (updated === null) throw new Error(`identity.user_account ${input.userId} vanished immediately after its own role grant`);
    return { outcome: 'granted', account: updated };
  }

  async revokeRole(input: RevokeRoleInput): Promise<RevokeRoleOutcome> {
    const outcome = await this.db.transaction().execute(async (trx) => {
      const grant = await trx
        .selectFrom('identity.user_role')
        .innerJoin('identity.role', 'identity.role.id', 'identity.user_role.role_id')
        .select('identity.user_role.id')
        .where('identity.user_role.user_account_id', '=', input.userId)
        .where('identity.role.code', '=', input.roleCode)
        .where('identity.user_role.revoked_at', 'is', null)
        .executeTakeFirst();

      if (grant === undefined) {
        const exists = await trx.selectFrom('identity.user_account').select('id').where('id', '=', input.userId).executeTakeFirst();
        return exists === undefined ? ({ outcome: 'not_found' } as const) : ({ outcome: 'not_held' } as const);
      }

      if (input.roleCode === 'ADM') {
        // `forUpdate` locks every active ADM grant row for the duration of
        // this transaction, so two concurrent revokes of two different
        // administrators cannot both read "one other admin exists" and
        // both proceed — the second waits for the first's commit and then
        // sees the correct, now-smaller count.
        const activeAdminGrants = await trx
          .selectFrom('identity.user_role')
          .innerJoin('identity.role', 'identity.role.id', 'identity.user_role.role_id')
          .select('identity.user_role.id')
          .where('identity.role.code', '=', 'ADM')
          .where('identity.user_role.revoked_at', 'is', null)
          .forUpdate()
          .execute();
        if (activeAdminGrants.length <= 1) {
          return { outcome: 'would_remove_last_admin' } as const;
        }
      }

      await trx.updateTable('identity.user_role').set({ revoked_at: input.now }).where('id', '=', grant.id).execute();
      return { outcome: 'revoked' } as const;
    });

    if (outcome.outcome !== 'revoked') return outcome;

    const account = await this.findAccountDetailById(input.userId);
    if (account === null) throw new Error(`identity.user_account ${input.userId} vanished immediately after its own role revocation`);
    return { outcome: 'revoked', account };
  }
}
