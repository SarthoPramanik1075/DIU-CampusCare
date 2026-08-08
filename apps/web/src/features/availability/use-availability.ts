import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchPublicAvailability, type PublicAvailabilityResponse } from './api.js';

/**
 * The API response carries `Cache-Control: public, max-age=60` (API §2.2) —
 * `staleTime` matches it, same reasoning as `useAnnouncements` (M0.5).
 */
const STALE_TIME_MS = 60_000;

export function usePublicAvailability(): UseQueryResult<PublicAvailabilityResponse> {
  return useQuery({
    queryKey: ['public', 'availability'],
    queryFn: fetchPublicAvailability,
    staleTime: STALE_TIME_MS,
  });
}
