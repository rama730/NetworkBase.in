import { createRoot } from 'react-dom/client';
import DeviceClient from '@/app/(site)/(auth)/device/DeviceClient';

// Report A2, A3: the approval page in every situation, against the real component and stylesheet. ?case= picks one.
const kase = new URLSearchParams(location.search).get('case') ?? 'agent';
const ws = (id: number, title: string, extra: Partial<{ viewerOnly: boolean; org: string | null; agentsOff: boolean }> = {}) =>
    ({ id: `${id}0000000-0000-4000-8000-000000000000`.slice(0, 36), title, slug: null, viewerOnly: false, org: null, agentsOff: false, ...extra });
const mine = [ws(1, 'Thesis'), ws(2, 'Shared notes', { viewerOnly: true }), ws(3, 'CSE 3B labs', { org: 'Riverside College', agentsOff: true })];
const many = Array.from({ length: 12 }, (_, i) => ws(i + 1, `Workspace ${i + 1}`, { org: i > 7 ? 'Riverside College' : null }));
const workspaces = kase === 'orgoff' ? [ws(3, 'CSE 3B labs', { org: 'Riverside College', agentsOff: true })]
    : kase === 'viewer' ? [ws(2, 'Shared notes', { viewerOnly: true })]
    : kase === 'many' ? many : kase === 'noworkspace' ? [] : mine;
const now = Date.now();
const pending = {
    userCode: 'D9GM-9N7Z', clientName: kase === 'oauth' ? 'Cursor' : 'NetworkBase CLI', deviceName: 'Chs-MacBook-Pro-with-a-really-long-hostname.local', clientVersion: kase === 'oauth' ? null : '2.0.4',
    platform: 'macOS', requestedType: kase === 'terminal' ? 'device' as const : 'agent' as const, agentName: kase === 'oauth' ? null : 'Claude Code', ipAddress: '203.0.113.7', country: 'IN',
    viaOAuth: kase === 'oauth', returnTo: kase === 'oauth' ? 'cursor://' : null, renewal: kase === 'renewal',
    prefill: kase === 'renewal' ? { access: 'small' as const, workspace: mine[0]!.id, expiryDays: 7 } : { access: 'full' as const, workspace: 'all', expiryDays: 30 },
    createdAt: new Date(now - 30_000).toISOString(), expiresAt: new Date(now + 9 * 60_000).toISOString(),
};
const signedOut = kase === 'signedout';
const code = kase === 'nocode' || signedOut ? '' : kase === 'mistyped' ? 'abcd-efgh' : pending.userCode;
const hasPending = !['signedout', 'nocode', 'mistyped'].includes(kase);
createRoot(document.getElementById('root')!).render(
    <DeviceClient viewerEmail={signedOut ? null : 'ada@example.com'} viewerId={signedOut ? null : 'u1'} code={code} pending={hasPending ? pending : null} workspaces={workspaces} />,
);
