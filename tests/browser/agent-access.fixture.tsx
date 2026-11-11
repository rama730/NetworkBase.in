import { createRoot } from 'react-dom/client';
import AgentAccessSettings from '@/components/settings/AgentAccessSettings';

// Report A4, A5, A8: Settings → an agent, against the real component and stylesheet. ?case= picks the data.
const kase = new URLSearchParams(location.search).get('case') ?? 'requests';
const workspaces = [
    { id: '11111111-1111-4111-8111-111111111111', title: 'Thesis', viewerOnly: false, org: null, agentsOff: false },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Shared notes', viewerOnly: true, org: null, agentsOff: false },
    { id: '33333333-3333-4333-8333-333333333333', title: 'CSE 3B labs', viewerOnly: false, org: 'Riverside College', agentsOff: true },
];
const view = {
    id: '99999999-9999-4999-8999-999999999999', agentName: 'Claude Code', deviceName: 'Chs-MacBook',
    sentence: 'Claude Code can work in all your workspaces for 30 days. It does small things itself and can’t finish tasks, change final files or edit docs.',
    preset: 'small' as const, extraScopes: [], workspace: 'all' as const, workspaceTitle: null,
    expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), lastSeenAt: new Date(Date.now() - 6e4).toISOString(),
    requests: kase === 'requests' ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scope: 'task:complete', words: 'finish tasks', reason: null, createdAt: new Date().toISOString() }] : [],
};
const prefill = kase === 'prefill' ? { access: 'read' as const, workspace: 'all' } : null;
createRoot(document.getElementById('root')!).render(<main><AgentAccessSettings view={view} workspaces={workspaces} focusRequest={view.requests[0]?.id ?? null} prefill={prefill} /></main>);
