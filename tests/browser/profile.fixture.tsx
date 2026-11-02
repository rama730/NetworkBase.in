import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { EditProfileEditor } from '@/components/profile/edit/EditProfileEditor';
import { confirmAppNavigation } from '@/lib/navigation/confirm-navigation';
import { parseProfileEditSection } from '@/lib/profile/edit-route';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';

const id = '11111111-1111-4111-8111-111111111111';
const initial = {
  id, username: 'builder', fullName: 'Builder', headline: 'Engineer', bio: 'I build things.',
  openToCollaborate: false, openTo: ['Contract roles'], openToCustomRoles: ['Rust Developer'],
  preferredCategories: ['Engineering'], hoursPerWeek: 'h_10_20', experienceLevel: 'senior', skills: [],
  socialLinks: {}, updatedAt: '2026-10-13T12:00:00.000Z', connectionsCount: 2, visibility: 'public',
};
const saved = JSON.parse(sessionStorage.getItem('profile') || 'null') || initial;
const fixture = (window as any).profileFixture = {
  saved, actorId:id, calls: [] as any[], fail: false, conflict: false, delay: 0, listFail: false,
  listTotal: 42, count: 2, viewer: false, locked: false,
  connectionStatus: 'none' as 'none' | 'accepted' | 'pending_incoming' | 'pending_outgoing',
  canMessage: true, canConnect: true, messaged: [] as string[],
  refresh: () => {},
  navigate(href:string,replace=false){
    window.history[replace?'replaceState':'pushState']({__NA:true},'',href);
    fixture.refresh();
  },
  async save(payload: any) {
    fixture.calls.push(payload);
    if (fixture.delay) await new Promise(r => setTimeout(r, fixture.delay));
    if (fixture.fail || fixture.conflict) return { success: false, error: 'Save failed', errorCode: fixture.conflict ? 'PROFILE_CONFLICT' : 'PROFILE_UPDATE_FAILED', currentProfile: {...fixture.saved}, updatedAt: fixture.saved.updatedAt };
    fixture.saved = { ...fixture.saved, ...payload, updatedAt: new Date(Date.now()).toISOString() };
    sessionStorage.setItem('profile', JSON.stringify(fixture.saved));
    fixture.refresh();
    return { success: true, updatedAt: fixture.saved.updatedAt };
  },
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function Fixture() {
  const [profile, setProfile] = useState(fixture.saved);
  useEffect(() => {
    fixture.refresh = () => setProfile({ ...fixture.saved });
    const pop=()=>fixture.refresh();window.addEventListener('popstate',pop);
    return () => { fixture.refresh = () => {};window.removeEventListener('popstate',pop); };
  }, []);
  return <QueryClientProvider client={client}>
    {window.location.pathname==='/my-profile/edit'?<div style={{height:'100dvh',display:'flex',flexDirection:'column'}}><header style={{height:56,flexShrink:0}}>NetworkBase</header><div style={{flex:1,minHeight:0,display:'flex'}}><nav className="hidden border-r border-border px-3 py-4 lg:block" aria-label="Fixture application navigation" style={{width:"var(--nb-sidebar-width)",flexShrink:0}}><div className="pr-1"><a className="nb-nav-link" href="/network">Network</a></div><button onClick={()=>{if(confirmAppNavigation())fixture.navigate("/network");}}>Open search result</button></nav><div style={{flex:1,minWidth:0,minHeight:0}}><EditProfileEditor profile={profile} initialSection={parseProfileEditSection(new URLSearchParams(location.search).get('section'))}/></div></div></div>:window.location.pathname==='/network'?<h1>Network destination</h1>:<ProfileV2Client profile={profile as any} isOwner={!fixture.viewer} currentUser={{ id: fixture.viewer ? '22222222-2222-4222-8222-222222222222' : id }}
      stats={{ connectionsCount: fixture.count, projectsCount: 0, followersCount: 0 }} connectionStatus={fixture.connectionStatus} lockedShell={fixture.locked}
      privacyRelationship={{ canViewProfile: !fixture.locked, canSendMessage: fixture.canMessage, canSendConnectionRequest: fixture.canConnect, blockedByViewer: false, blockedByTarget: false, visibilityReason: 'public', connectionState: fixture.connectionStatus === 'accepted' ? 'connected' : fixture.connectionStatus }} />} 
    <Toaster />
  </QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
