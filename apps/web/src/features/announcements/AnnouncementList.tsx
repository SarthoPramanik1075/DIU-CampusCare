import type { JSX } from 'react';

import { Banner } from '../../shared/primitives/Banner.js';
import { Skeleton } from '../../shared/Skeleton.js';
import { useDelayedFlag } from '../../shared/use-delayed-flag.js';

import { useAnnouncements } from './use-announcements.js';

const SKELETON_DELAY_MS = 300;
const LOADING_TEXT_DELAY_MS = 2000;

/**
 * P-01's live-data vertical slice — API §2.5 `GET /api/v1/public/announcements`
 * rendered as info banners (FRONTEND §5.8: "Announcements (FR-ADM-04) render
 * as `info`, dismissible per session").
 *
 * Zero active announcements is a normal, common state (most days carry
 * none) and renders nothing here — unlike `CrisisBanner`, an announcement
 * list has no "must never be empty" requirement, so an empty result is not
 * a failure state needing an `EmptyState` treatment.
 */
export function AnnouncementList(): JSX.Element | null {
  const { data, isPending, isError, error } = useAnnouncements();
  const showSkeleton = useDelayedFlag(isPending, SKELETON_DELAY_MS);
  const showLoadingText = useDelayedFlag(isPending, LOADING_TEXT_DELAY_MS);

  if (isPending) {
    if (!showSkeleton) return null;
    return (
      <div aria-busy="true" aria-live="polite">
        <Skeleton width="100%" height="64px" />
        {showLoadingText && <span className="cc-visually-hidden">Loading announcements…</span>}
      </div>
    );
  }

  if (isError) {
    return (
      <Banner
        tone="warning"
        message={`Announcements couldn't be loaded right now (${error.message}). The rest of this page still works.`}
      />
    );
  }

  if (data.length === 0) {
    return null;
  }

  return (
    <div role="list" aria-label="Announcements">
      {data.map((announcement) => (
        <div role="listitem" key={announcement.id} style={{ marginBottom: 'var(--space-2)' }}>
          <Banner tone="info" message={announcement.body} />
        </div>
      ))}
    </div>
  );
}
