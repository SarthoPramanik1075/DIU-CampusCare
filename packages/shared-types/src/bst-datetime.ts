import type { IsoDateTimeString } from './primitives.js';

/**
 * Formats an instant as ISO-8601 with the literal `+06:00` offset — API §0.8:
 * "Always `+06:00`". Bangladesh Standard Time has held a fixed UTC+6 offset
 * with no daylight-saving adjustment throughout this system's operating
 * window, so the offset suffix is written directly rather than computed —
 * but the wall-clock digits themselves come from `Intl.DateTimeFormat` with
 * an explicit `Asia/Dhaka` time zone, not from adding six hours to UTC by
 * hand, so this stays correct regardless of what time zone the Node process
 * or the database connection happens to be running in.
 *
 * `timestamptz` columns round-trip through node-postgres as `Date` objects,
 * which are internally timezone-agnostic (epoch milliseconds) — the
 * database's session timezone affects only how a value is rendered *as
 * text* by Postgres itself, never what a driver-parsed `Date` means. This
 * function is the one place that rendering happens for this system, so it
 * is the one place VR-91 ("all dates and times interpreted in BST") has to
 * be gotten right.
 */
const BST_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Dhaka',
  hourCycle: 'h23', // not hour12:false — some ICU builds render midnight as "24" without it
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function toBstIsoString(date: Date): IsoDateTimeString {
  // Explicit <string, string> rather than inferred: newer TS DOM libs type
  // `DateTimeFormatPart.type` as a registry-constrained literal union, not
  // plain `string`, which would otherwise infect this Map's key type and
  // make a plain-string `.get()` call below a type error.
  const parts = new Map<string, string>(
    BST_PARTS_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const get = (type: string): string => {
    const value = parts.get(type);
    if (value === undefined) {
      throw new Error(`Intl.DateTimeFormat did not produce a "${type}" part.`);
    }
    return value;
  };
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+06:00` as IsoDateTimeString;
}
