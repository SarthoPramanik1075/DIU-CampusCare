import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchDashboard, type DashboardDto } from './api.js';

export function useDashboard(): UseQueryResult<DashboardDto> {
  return useQuery({
    queryKey: ['me', 'dashboard'],
    queryFn: fetchDashboard,
    staleTime: 30_000,
  });
}
