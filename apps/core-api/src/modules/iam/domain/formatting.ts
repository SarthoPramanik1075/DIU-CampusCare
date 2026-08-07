/**
 * Domain layer — DR-6. `Intl` is a JS language built-in, not a framework or
 * I/O dependency, so a pure `Date -> string` formatter belongs here same as
 * any other domain predicate.
 *
 * FRONTEND §5.7: "all times 12-hour with meridiem, all in BST." Used only
 * to embed a human time inside a user-facing error message (API §1.3's
 * `ACCOUNT_LOCKED`: "locked until 3:20 PM") — the wire format for
 * structured timestamp fields is `toBstIsoString` in `@campuscare/shared-types`,
 * which this does not replace.
 */
const BST_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Dhaka',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatBstTime(date: Date): string {
  return BST_TIME_FORMATTER.format(date);
}
