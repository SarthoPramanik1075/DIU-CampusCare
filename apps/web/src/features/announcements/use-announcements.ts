import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchAnnouncements, type AnnouncementDto } from './api.js';

/**
 * The API response carries `Cache-Control: public, max-age=60` (API §2.5) —
 * `staleTime` matches it, so React Query does not re-fetch more often than
 * the response itself promises to change, and FRONTEND §5.11's rule against
 * a full-page spinner on cached data holds: a second mount within the
 * window renders the previous result immediately.
 */
const STALE_TIME_MS = 60_000;

export function useAnnouncements(): UseQueryResult<readonly AnnouncementDto[]> {
  return useQuery({
    queryKey: ['public', 'announcements'],
    queryFn: fetchAnnouncements,
    staleTime: STALE_TIME_MS,
  });
}
