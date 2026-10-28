import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsLayout from '@/components/settings/SettingsLayout';
import SettingsDocument from '@/components/settings/SettingsDocument';
import { ThemeProvider } from '@/components/providers/theme-provider';

// The real Settings document, real hooks and real components. Only the edges are replaced by the spec: server
// actions answer from window.__actions, and fetch is routed by Playwright.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const fixture = (window as any).settingsFixture = {
  refresh: () => {},
  navigate(href: string, replace = false) { window.history[replace ? 'replaceState' : 'pushState']({ __NA: true }, '', href); fixture.refresh(); },
};
function Fixture() {
  const [, refresh] = useState(0);
  useEffect(() => {
    fixture.refresh = () => refresh((value) => value + 1);
    window.addEventListener('popstate', fixture.refresh);
    return () => window.removeEventListener('popstate', fixture.refresh);
  }, []);
  return <QueryClientProvider client={client}><ThemeProvider>
    <div id="app-main" className="flex h-dvh flex-col overflow-hidden"><header className="h-14 shrink-0">NetworkBase</header><div className="min-h-0 flex-1"><SettingsLayout><SettingsDocument /></SettingsLayout></div></div>
  </ThemeProvider></QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
