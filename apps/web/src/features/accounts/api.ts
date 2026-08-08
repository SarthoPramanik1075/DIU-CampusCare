import type { AuthenticatedRoleCode, RoleCode } from '@campuscare/shared-types';

import { apiDelete, apiGet, apiPatch, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'deactivated';

/** API §1.3's `GET /users` list-item shape. */
export interface AccountListItemDto {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly roles: readonly AuthenticatedRoleCode[];
  readonly studentRef: string | null;
  readonly createdAt: string;
  readonly version: number;
}

export interface AccountListPageDto {
  readonly items: readonly AccountListItemDto[];
  readonly nextCursor: string | null;
}

export interface AccountListFilters {
  readonly q?: string;
  readonly status?: AccountStatus;
  readonly role?: AuthenticatedRoleCode;
  readonly cursor?: string;
}

export interface AccountRoleDto {
  readonly code: RoleCode;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

/**
 * API §1.3's `GET /users/{id}` example lists exactly nine fields and
 * deliberately omits `isClinicalStaff` even though `PATCH` accepts it as a
 * write — see `account-admin.routes.ts`'s `accountDetailDto` on the
 * backend. This DTO follows the documented wire shape exactly, which means
 * A-04's "disable CNP unless the account is flagged clinical staff" cannot
 * be evaluated client-side (there is nothing to read it from). Documented
 * as a raised-not-taken gap in `000_AMENDMENTS.md`; the grant attempt
 * surfaces the server's authoritative VR-04 rejection instead.
 */
export interface AccountDetailDto {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly authMethod: 'sso' | 'local';
  readonly roles: readonly AccountRoleDto[];
  readonly studentProfile: { readonly studentRef: string } | null;
  readonly lockedUntil: string | null;
  readonly lastLoginAt: string | null;
  readonly version: number;
}

export interface RoleCatalogueEntryDto {
  readonly code: RoleCode;
  readonly name: string;
  readonly assignableByAdmin: boolean;
  readonly requiresClinicalStaff: boolean;
}

export interface ActiveAppointmentSummaryDto {
  readonly appointmentRef: string;
  readonly sessionDate: string;
  readonly doctorName: string;
}

export interface DeactivateAccountResultDto {
  readonly userId: string;
  readonly status: 'deactivated';
  readonly cancelledAppointments: readonly ActiveAppointmentSummaryDto[];
  readonly version: number;
}

function buildQuery(filters: AccountListFilters): string {
  const params = new URLSearchParams();
  if (filters.q !== undefined && filters.q.length > 0) params.set('q', filters.q);
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.role !== undefined) params.set('role', filters.role);
  if (filters.cursor !== undefined) params.set('cursor', filters.cursor);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function fetchAccounts(filters: AccountListFilters): Promise<AccountListPageDto> {
  return apiGet<AccountListPageDto>(CORE_API_URL, `/api/v1/users${buildQuery(filters)}`);
}

export function fetchAccountDetail(userId: string): Promise<AccountDetailDto> {
  return apiGet<AccountDetailDto>(CORE_API_URL, `/api/v1/users/${userId}`);
}

export function fetchRoleCatalogue(): Promise<{ readonly items: readonly RoleCatalogueEntryDto[] }> {
  return apiGet(CORE_API_URL, '/api/v1/roles');
}

export interface CreateAccountInput {
  readonly email: string;
  readonly fullName: string;
  readonly authMethod: 'sso' | 'local';
  readonly roles: readonly AuthenticatedRoleCode[];
  readonly isClinicalStaff: boolean;
}

export function createAccount(input: CreateAccountInput, csrfToken: string): Promise<AccountDetailDto> {
  return apiPost<AccountDetailDto>(CORE_API_URL, '/api/v1/users', input, csrfToken);
}

export interface UpdateAccountInput {
  readonly fullName?: string;
  readonly isClinicalStaff?: boolean;
  readonly version: number;
}

export function updateAccount(userId: string, input: UpdateAccountInput, csrfToken: string): Promise<AccountDetailDto> {
  return apiPatch<AccountDetailDto>(CORE_API_URL, `/api/v1/users/${userId}`, input, csrfToken);
}

export function suspendAccount(userId: string, reason: string, version: number, csrfToken: string): Promise<AccountDetailDto> {
  return apiPost<AccountDetailDto>(CORE_API_URL, `/api/v1/users/${userId}/suspend`, { reason, version }, csrfToken);
}

export function activateAccount(userId: string, reason: string, version: number, csrfToken: string): Promise<AccountDetailDto> {
  return apiPost<AccountDetailDto>(CORE_API_URL, `/api/v1/users/${userId}/activate`, { reason, version }, csrfToken);
}

export function deactivateAccount(
  userId: string,
  reason: string,
  version: number,
  confirmedImpact: boolean,
  csrfToken: string,
): Promise<DeactivateAccountResultDto> {
  return apiPost<DeactivateAccountResultDto>(
    CORE_API_URL,
    `/api/v1/users/${userId}/deactivate`,
    { reason, version, confirmedImpact },
    csrfToken,
  );
}

export function grantRole(
  userId: string,
  roleCode: AuthenticatedRoleCode,
  reason: string,
  csrfToken: string,
): Promise<AccountDetailDto> {
  return apiPost<AccountDetailDto>(CORE_API_URL, `/api/v1/users/${userId}/roles`, { roleCode, reason }, csrfToken);
}

export function revokeRole(
  userId: string,
  roleCode: AuthenticatedRoleCode,
  reason: string,
  csrfToken: string,
): Promise<AccountDetailDto> {
  return apiDelete<AccountDetailDto>(CORE_API_URL, `/api/v1/users/${userId}/roles/${roleCode}`, { reason }, csrfToken);
}
