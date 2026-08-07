import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Public views are read by anonymous visitors on the move (CON-06 —
        // 3G, mid-range Android); retrying a failed request a couple of
        // times before surfacing an error is worth more here than fast
        // failure.
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}
