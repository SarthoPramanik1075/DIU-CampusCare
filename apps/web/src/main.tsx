import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createAppQueryClient } from './app/query-client.js';
import { router } from './app/router.js';
import './shared/global.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root element is missing from index.html');
}

const queryClient = createAppQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
