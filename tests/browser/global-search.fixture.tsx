import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/components/providers/theme-provider';
import CommandPalette from '@/components/layout/header/CommandPalette';
import SearchPageClient from '@/components/search/SearchPageClient';

// Global search mix: the real box and the real results page, with the search answered by the spec (no server).
const params = new URLSearchParams(location.search);
const w = window as unknown as Record<string, unknown>;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => params.get('from') ?? '/discover', push: (to: string) => { w.__pushed = to; } };
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const surface = params.get('surface') ?? 'box';

function Fixture() {
  if (surface === 'page') {
    return <div style={{ height: '100dvh' }}><SearchPageClient saved={null} /></div>;
  }
  return (
    <div>
      <header className="nb-topbar border-b border-border bg-card" style={{ height: 56, display: 'flex' }}>
        <div style={{ width: 240 }} />
        <div className="nb-cell nb-cell-search flex min-w-0 flex-1">Search</div>
      </header>
      <CommandPalette isOpen onClose={() => undefined} initialQuery={params.get('q') ?? ''} recentSearchOwnerId="u1" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><ThemeProvider><Fixture /></ThemeProvider></QueryClientProvider>);
