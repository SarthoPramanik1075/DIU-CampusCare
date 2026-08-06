/**
 * Wire-format primitives — API.md §0.8.
 *
 * These are branded string aliases. They carry no runtime cost and no runtime
 * validation; their job is to make a misuse visible at the type level, so that
 * a local time and an instant cannot be passed to each other by accident.
 *
 * Runtime validation belongs at the interface boundary (request schemas), not
 * here. A type alias that pretended to validate would be worse than one that
 * plainly does not.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** UUIDv7, application-generated. DATABASE §3 — no database default, by design. */
export type Uuid = Brand<string, 'Uuid'>;

/**
 * An instant, ISO-8601 with an explicit offset: `2026-08-03T14:30:00+06:00`.
 *
 * Always `+06:00`. VR-91 — all times are Bangladesh Standard Time and no other
 * timezone is accepted. EC-54 — every time-sensitive decision is evaluated
 * against server time, so a client-supplied instant is advisory metadata only.
 */
export type IsoDateTimeString = Brand<string, 'IsoDateTimeString'>;

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDateString = Brand<string, 'IsoDateString'>;

/**
 * A local wall-clock time, `HH:mm`, with no offset.
 *
 * Deliberately distinct from {@link IsoDateTimeString}. A duty roster entry is
 * "every Sunday 09:00" — a recurring intention, not an instant (DATABASE §9).
 * Store hours are the same. Conflating the two is how a schedule silently
 * shifts across a boundary.
 */
export type LocalTimeString = Brand<string, 'LocalTimeString'>;
