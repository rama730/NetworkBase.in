import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { PeerReviewCard } from '@/components/organizations/PeerReview';

// Report 30.8 call (plan B1.5c): peer review in the student's hand-in.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px' }}><PeerReviewCard copyId="6a1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /></main>
    <Toaster />
  </QueryClientProvider>,
);
