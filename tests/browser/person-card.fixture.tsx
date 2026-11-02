import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PersonCard from '@/components/network/PersonCard';
import { PersonCardContent } from '@/components/network/PersonCardContent';
import { PersonCardReview } from '@/components/network/PersonCardReview';
import { PersonCardSkeleton } from '@/components/network/PersonCardSkeleton';
import InvitationsClient from '@/components/network/InvitationsClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SuggestedProfile } from '@/app/actions/connections';

const base: SuggestedProfile = {
    id: '11111111-1111-4111-8111-111111111111', username: 'mira', fullName: 'Mira Vale', avatarUrl: null,
    headline: 'Full-stack developer', location: 'Lisbon, Portugal', connectionStatus: 'none',
    openToCollaborate: true, canConnect: true, mutualConnections: 6,
    portfolio: { total: 1, projects: [{ id: 'p', title: 'Ponytail', slug: 'ponytail' }] },
    skills: ['React', 'TypeScript', 'Figma', 'Next.js', 'Node.js', 'PostgreSQL', 'Accessibility', 'Design systems'],
};
const patches: Record<string, Partial<SuggestedProfile>> = {
    complete: {}, connected: {}, private: { isLockedProfile: true }, sparse: { headline: null, location: null, skills: [], portfolio: null, openToCollaborate: false, mutualConnections: null },
    noHeadline: { headline: null }, noLocation: { location: null }, noSkills: { skills: [] }, noPortfolio: { portfolio: null },
    unknown: { openToCollaborate: null, mutualConnections: null, portfolio: null }, off: { openToCollaborate: false },
    manyProjects: { portfolio: { total: 32, projects: [] } }, untitled: { portfolio: { total: 1, projects: [{ id: 'p', title: ' ', slug: null }] } },
    long: { fullName: 'Alexandria Ramana Chandrasekhar', location: 'Vijayawada, Andhra Pradesh, India · Remote across Europe and Asia', headline: 'Product engineer building accessible collaboration systems for distributed creative teams', skills: ['Human-computer interaction', 'Accessible interaction design', 'Distributed systems architecture', 'TypeScript', 'Information architecture'] },
    unicode: { fullName: 'نور علي', headline: 'مصممة منتجات رقمية وتجارب تعاونية', location: 'دبي', skills: ['تصميم المنتجات','TypeScript','研究设计','Accessibility'] },
    largeShared: { mutualConnections: 12480 }, invalidDate: {}, missingName: { fullName: ' ', username: null },
    whitespace: { headline: ' ', location: ' ', skills: ['React', ' React ', '', 'react', 'TypeScript'] },
    noRequests: { canConnect: false }, pending: { connectionStatus: 'pending_sent' }, incoming: { connectionStatus: 'pending_received' },
};
declare global { interface Window { personCardFixture: { fail: boolean; decisionsFail: boolean; sharedCalls: number; connects: number } } }
window.personCardFixture = { fail: false, decisionsFail: false, sharedCalls: 0, connects: 0 };
function Fixture() {
    const [kind, setKind] = useState('complete');
    const [width, setWidth] = useState(404);
    const [dark, setDark] = useState(false);
    const [variant, setVariant] = useState<'network' | 'rail'>('network');
    const [client] = useState(() => new QueryClient({defaultOptions:{queries:{retry:false}}}));
    const person = { ...base, ...patches[kind] };
    const controlled = ['connected', 'invalidDate', 'review'].includes(kind);
    return <div className={dark ? 'dark' : ''} style={{ minHeight: '100vh', padding: 12 }}>
        <div className="flex flex-wrap gap-2 mb-6">
            <label>Scenario<select aria-label="Scenario" value={kind} onChange={e => setKind(e.target.value)}>{[...Object.keys(patches),'review','loading','invitations'].map(key => <option key={key}>{key}</option>)}</select></label>
            <label>Width<input aria-label="Width" type="number" value={width} onChange={e => setWidth(Number(e.target.value))} /></label>
            <button onClick={() => setDark(value => !value)}>Theme</button>
            <button onClick={() => setVariant(value => value === 'network' ? 'rail' : 'network')}>Variant</button>
            <button onClick={() => { window.personCardFixture.fail = !window.personCardFixture.fail; }}>Fail requests</button>
        </div>
        <div data-testid="card-holder" style={{ width, maxWidth: '100%' }}>
            {kind === 'invitations' ? <QueryClientProvider client={client}><InvitationsClient initialUser={{id:'viewer'}} searchQuery="" /></QueryClientProvider> : kind === 'loading' ? <PersonCardSkeleton variant={variant} /> : controlled ? <PersonCardContent person={person} variant={variant} viewerSkills={['React','Figma','TypeScript']} connected={kind !== 'review'} acceptedAt={kind === 'invalidDate' ? 'invalid' : '2026-05-14T12:00:00Z'}
                action={kind === 'review' ? <PersonCardReview name="Mira Vale" description="Design lead at Field Notes" onAccept={async () => { if (window.personCardFixture.decisionsFail) throw new Error('Request service unavailable'); }} onDecline={async () => false} /> : <button className="nb-person-control">Connected</button>}
            /> : <PersonCard key={kind} profile={person} variant={variant} viewerSkills={['React','Figma','TypeScript']} onConnect={async () => {
                window.personCardFixture.connects++; await new Promise(resolve => setTimeout(resolve, 80)); if (window.personCardFixture.fail) throw new Error('Request failed');
            }} />}
        </div>
    </div>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>);
