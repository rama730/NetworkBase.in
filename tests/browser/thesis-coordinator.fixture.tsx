import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThesisCoordinator } from '@/components/organizations/ThesisCoordinator';

// Report 30.6 W5 (plan B1.8c): the coordinator's Theses table.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}><ThesisCoordinator orgId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /></main></QueryClientProvider>,
);
