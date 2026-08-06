/**
 * Domain layer — DR-6: no framework, HTTP or persistence type may appear
 * here. An `Announcement` is a fact about the world (FR-ADM-04); it has no
 * opinion on how it is stored or served.
 */
export interface Announcement {
  readonly id: string;
  readonly body: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** API §2.5: "Returns only announcements where server time falls between startsAt and endsAt." */
export function isActive(announcement: Announcement, now: Date): boolean {
  return announcement.startsAt.getTime() <= now.getTime() && now.getTime() <= announcement.endsAt.getTime();
}
