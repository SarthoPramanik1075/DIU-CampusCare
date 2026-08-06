import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { ConfigValueType, Database } from '../../infrastructure/database/client.js';
import { ConflictError, ValidationError } from '../errors/domain-error.js';
import { err, ok, type Result } from '../shared/result.js';


/**
 * Every 【A】 value, changeable without redeployment — FR-ADM-01, BR-70.
 *
 * This is the *only* place a configured value is read or written in the
 * system. DR-4 forbids a module from holding a business constant in code —
 * "3 active bookings", "10 minute slots", "50 BDT" all live in
 * `config.system_config`, fetched through this class. A number typed
 * directly into domain code is not a shortcut; it is the value becoming
 * unconfigurable and the audit trail (FR-ADM-02) losing the change.
 */
export interface PolicyValue {
  readonly key: string;
  readonly valueType: ConfigValueType;
  readonly valueText: string;
  readonly minValue: string | null;
  readonly maxValue: string | null;
  readonly description: string;
  readonly version: number;
}

export class PolicyStore {
  constructor(private readonly db: Kysely<Database>) {}

  async get(key: string): Promise<PolicyValue | undefined> {
    const row = await this.db
      .selectFrom('config.system_config')
      .selectAll()
      .where('config_key', '=', key)
      .executeTakeFirst();
    return row === undefined ? undefined : toPolicyValue(row);
  }

  async list(prefix?: string): Promise<readonly PolicyValue[]> {
    let query = this.db.selectFrom('config.system_config').selectAll();
    if (prefix !== undefined) {
      query = query.where('config_key', 'like', `${prefix}%`);
    }
    const rows = await query.orderBy('config_key').execute();
    return rows.map(toPolicyValue);
  }

  /**
   * A required integer value. Throws rather than returning `undefined` for a
   * missing or malformed key — a domain module reading a configured slot
   * length has no sensible fallback, and silently defaulting to some number
   * is exactly the DR-4 violation this class exists to prevent in reverse.
   */
  async getRequiredInteger(key: string): Promise<number> {
    const value = await this.get(key);
    if (value === undefined) {
      throw new ValidationError({
        code: 'CONFIG_KEY_UNKNOWN',
        message: `No configuration value named "${key}" exists.`,
      });
    }
    const parsed = Number.parseInt(value.valueText, 10);
    if (Number.isNaN(parsed)) {
      throw new ValidationError({
        code: 'CONFIG_TYPE_MISMATCH',
        message: `Configuration value "${key}" is not an integer.`,
      });
    }
    return parsed;
  }

  async getRequiredBoolean(key: string): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) {
      throw new ValidationError({
        code: 'CONFIG_KEY_UNKNOWN',
        message: `No configuration value named "${key}" exists.`,
      });
    }
    return value.valueText === 'true';
  }

  /**
   * Defines a configuration entry if it does not already exist. Idempotent,
   * for seeding defaults at startup — never overwrites a value an
   * administrator has since changed, which is the property that makes it
   * safe to run on every deploy.
   */
  async defineIfAbsent(entry: {
    readonly key: string;
    readonly valueType: ConfigValueType;
    readonly valueText: string;
    readonly minValue?: string | null;
    readonly maxValue?: string | null;
    readonly description: string;
  }): Promise<void> {
    await this.db
      .insertInto('config.system_config')
      .values({
        id: uuidv7(),
        config_key: entry.key,
        value_type: entry.valueType,
        value_text: entry.valueText,
        min_value: entry.minValue ?? null,
        max_value: entry.maxValue ?? null,
        description: entry.description,
      })
      .onConflict((oc) => oc.column('config_key').doNothing())
      .execute();
  }

  /**
   * Changes a value. VR-94: an out-of-range value is rejected here, at save
   * — never at the point of use, where a domain module would otherwise have
   * to re-validate a value it has no authority to reject.
   *
   * `expectedVersion` implements VR-92 the same way every other mutable
   * table in the schema does, even though `config.system_config` has no
   * `trg_..._version` trigger attached (DATABASE.md attaches that trigger
   * selectively; this table's compare-and-swap is done here instead, with
   * the same effect: a stale write is rejected, never merged).
   */
  async set(input: {
    readonly key: string;
    readonly valueText: string;
    readonly updatedBy: string;
    readonly expectedVersion: number;
  }): Promise<Result<PolicyValue, ValidationError | ConflictError>> {
    const current = await this.db
      .selectFrom('config.system_config')
      .selectAll()
      .where('config_key', '=', input.key)
      .executeTakeFirst();

    if (current === undefined) {
      return err(
        new ValidationError({
          code: 'CONFIG_KEY_UNKNOWN',
          message: `No configuration value named "${input.key}" exists.`,
        }),
      );
    }

    const rangeError = validateRange(current, input.valueText);
    if (rangeError !== undefined) return err(rangeError);

    const result = await this.db
      .updateTable('config.system_config')
      .set({
        value_text: input.valueText,
        updated_by: input.updatedBy,
        updated_at: new Date(),
        version: current.version + 1,
      })
      .where('config_key', '=', input.key)
      .where('version', '=', input.expectedVersion)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message:
            'Someone else updated this a moment ago. Review it and try again if you still need to.',
        }),
      );
    }

    return ok({
      key: input.key,
      valueType: current.value_type,
      valueText: input.valueText,
      minValue: current.min_value,
      maxValue: current.max_value,
      description: current.description,
      version: current.version + 1,
    });
  }
}

function toPolicyValue(row: {
  config_key: string;
  value_type: ConfigValueType;
  value_text: string;
  min_value: string | null;
  max_value: string | null;
  description: string;
  version: number;
}): PolicyValue {
  return {
    key: row.config_key,
    valueType: row.value_type,
    valueText: row.value_text,
    minValue: row.min_value,
    maxValue: row.max_value,
    description: row.description,
    version: row.version,
  };
}

function validateRange(
  current: { config_key: string; value_type: ConfigValueType; min_value: string | null; max_value: string | null },
  candidateValueText: string,
): ValidationError | undefined {
  if (current.value_type !== 'integer' && current.value_type !== 'decimal') return undefined;
  if (current.min_value === null && current.max_value === null) return undefined;

  const candidate = Number.parseFloat(candidateValueText);
  if (Number.isNaN(candidate)) {
    return new ValidationError({
      code: 'CONFIG_TYPE_MISMATCH',
      message: `"${current.config_key}" needs a number.`,
      fields: [{ field: 'value', rule: 'VR-94', message: 'Must be a number' }],
    });
  }

  const min = current.min_value === null ? undefined : Number.parseFloat(current.min_value);
  const max = current.max_value === null ? undefined : Number.parseFloat(current.max_value);

  if ((min !== undefined && candidate < min) || (max !== undefined && candidate > max)) {
    const range =
      min !== undefined && max !== undefined
        ? `between ${String(min)} and ${String(max)}`
        : min !== undefined
          ? `at least ${String(min)}`
          : `at most ${String(max)}`;
    return new ValidationError({
      code: 'CONFIG_OUT_OF_RANGE',
      message: `"${current.config_key}" must be ${range}.`,
      fields: [{ field: 'value', rule: 'VR-94', message: `Must be ${range}` }],
      details: { minValue: current.min_value, maxValue: current.max_value },
    });
  }

  return undefined;
}
