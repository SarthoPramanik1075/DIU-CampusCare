import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AnnouncementList } from './AnnouncementList.js';
import * as api from './api.js';

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('AnnouncementList', () => {
  it('renders nothing when there are no active announcements', async () => {
    vi.spyOn(api, 'fetchAnnouncements').mockResolvedValue([]);
    const { container } = renderWithClient(<AnnouncementList />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders each announcement body as an info banner', async () => {
    vi.spyOn(api, 'fetchAnnouncements').mockResolvedValue([
      {
        id: '0191f5aa-0000-0000-0000-000000000000',
        body: 'The medical centre will close at 1 PM on 12 August.',
        startsAt: '2026-08-01T00:00:00+06:00',
        endsAt: '2026-08-12T23:59:00+06:00',
      },
    ]);
    renderWithClient(<AnnouncementList />);
    expect(await screen.findByText('The medical centre will close at 1 PM on 12 August.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders a warning banner (not a dead end) when the request fails', async () => {
    vi.spyOn(api, 'fetchAnnouncements').mockRejectedValue(new Error('Service unavailable'));
    renderWithClient(<AnnouncementList />);
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be loaded");
  });
});
