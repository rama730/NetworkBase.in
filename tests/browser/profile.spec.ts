import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test } from '@playwright/test';
let script: string;
let css: string;
let instrumentFont: Buffer;
let monoFont: Buffer;
const origin = 'https://profile.test';

test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    'next/navigation': `const router={refresh:()=>window.profileFixture.refresh(),prefetch:()=>{},push:p=>window.profileFixture.navigate(p),replace:p=>window.profileFixture.navigate(p,true)};export const useRouter=()=>router;export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);`,
    'next/link': `import React from 'react'; export default ({children,href,...props})=>React.createElement('a',{href,...props},children);`,
    'next/image': `import React from 'react'; export default ({priority,fill,unoptimized,...props})=>React.createElement('img',props);`,
    'next/dynamic': `import React from 'react'; export default load=>{const C=React.lazy(async()=>{const m=await load();return {default:m.default||m};});return p=>React.createElement(React.Suspense,{fallback:null},React.createElement(C,p));};`,
    '@/hooks/useAuth': `export const useAuth=()=>({user:{id:'11111111-1111-4111-8111-111111111111'},session:null,refreshProfile:async()=>{}});`,
    '@/app/actions/sharing-destinations': `export const listShareDestinations=async()=>({success:true,viewerId:'11111111-1111-4111-8111-111111111111',channels:[],nextCursor:null});export const listShareWorkspaces=async()=>({success:true,viewerId:'11111111-1111-4111-8111-111111111111',projects:[],nextCursor:null});export const getShareDestination=async()=>({success:false,error:'chat_not_member'});`,
    '@/app/actions/sharing': `export const sendSharedLink=async()=>({success:true});export const saveShareUsername=async()=>({success:true});`,
    '@/components/messages/ChatShellProvider': `export const useMutedIds=()=>new Set();export const useChatShell=()=>({data:{channels:[]},refresh:()=>{},loadError:null});`,
    '@/components/providers/AuthProvider': `export const useAuthContext=()=>({user:window.profileFixture.actorId?{id:window.profileFixture.actorId}:null,refreshProfile:async()=>{}});export const AuthProvider=({children})=>children;export default ({children})=>children;`,
    '@/hooks/use-auth': `export const useAuth=()=>({user:window.profileFixture.actorId?{id:window.profileFixture.actorId}:null,refreshProfile:async()=>{}});`,
    '@/hooks/useUsernameAvailability': `export const useUsernameAvailability=({value,currentUsername})=>!value||value===currentUsername?{status:'idle',message:''}:(window.profileFixture?.takenUsernames??[]).includes(value)?{status:'invalid',message:'Username is taken'}:{status:'valid',message:''};`,
    '@/lib/skills/client': `const catalog={version:'fixture',categories:[{key:'engineering',name:'Engineering',iconKey:'code'}],lookup:{},defaults:[]};export const useSkillCatalog=()=>catalog;export const resolveClientSkill=name=>({name,canonicalKey:name.toLowerCase(),categoryKey:'engineering',kind:'framework',iconSource:'monogram',status:'active'});export const defaultClientSkills=()=>['React','TypeScript'].map(resolveClientSkill);`,
    '@/components/skills': `export const SkillIcon=()=>null;`,
    '@/components/presence/presence-ui-store': `export const usePresenceUi=()=>open=>{window.profileFixture.pickerOpen=open;};`,
    '@/components/presence/usePresence': `export const useNow=()=>Date.now();export const usePersonPresence=()=>{const p=window.profileFixture.presence||({availability:'now',availabilityText:'Active now',status:null});return {...p,label:[p.status?.emoji,p.statusText,p.availabilityText].filter(Boolean).join(' · ')};};export const useWorkspacePresence=()=>({availability:'offline',label:'Offline'});`,
    '@/components/messages/message-user': `export const messageUserInWindow=id=>{window.profileFixture.messaged.push(id);return true;};`,
    '@/app/actions/contribution-stories': `export const saveContributionStoryAction=async(c)=>{window.profileFixture.storyCalls.push(c);return {success:true,id:c.id,version:(c.expectedVersion||1)+1,featured:c.operation==='feature',published:true};};const none=async()=>({success:false,error:'Not in this fixture'});export const createContributionStoryAction=none,searchContributionReferencesAction=async()=>({success:true,options:[]}),createContributionImageUploadAction=none,finalizeContributionImageAction=none,importContributionWorkspaceImageAction=none,listContributionLinkWorkspacesAction=async()=>({success:true,projects:[]});`,
    '@/app/actions/org-profile': `const ok=async()=>({success:true});export const dismissContributionNudgeAction=ok,readOrgStoryStarterAction=async()=>({success:true,text:''}),revokeOrgVerificationAction=ok,verifyOrgContributionsAction=async()=>({success:true,verified:0});`,
    './ProfileInviteModal': `export default ()=>null;`,
    '@/components/workspaces/ApplyRoleModal': `export default ()=>null;`,
    '@/app/actions/profile-contributions': `export const saveProfileContributionsAction=async()=>({success:true});`,
    '@/app/actions/profile': `export const updateProfileAction=p=>window.profileFixture.save(p); export const createProfileImageUploadUrlAction=async()=>({});export const finalizeProfileImageUploadAction=async()=>({});`,
    '@/lib/services/avatar-worker-client': `export const compressAvatarOffMainThread=async f=>f;`,
    '@/lib/upload/supabase-signed-upload-client': `export const uploadToSupabaseSignedUrl=async()=>{};`,
    '@/lib/profile/browser-profile': `export const loadProfileContributionsPage=async()=>({contributions:[],total:0,hasMore:false});export const loadProfileContributionWindow=async()=>({contributions:[],total:0,hasMore:false});`,
    '@/app/actions/connections': `export const readPersonSharedConnectionsAction=async()=>({success:true,summary:{targetIds:[],total:5,people:[{id:'p1',username:'priya',fullName:'Priya Nair',avatarUrl:null,headline:'Backend engineer'},{id:'p2',username:'alexc',fullName:'Alex Chen',avatarUrl:null,headline:'Designer'}]}});export const getProfileConnectionCountAction=async()=>({success:true,connectionsCount:window.profileFixture.count});
      export const getAcceptedConnections=async({search,cursor})=>window.profileFixture.listFail?{success:false,error:'Connection service unavailable'}:{success:true,totalConnections:42,hasMore:!search&&!cursor,nextCursor:'next',connections:Array.from({length:search?1:cursor?12:30},(_,i)=>({id:String((cursor?30:0)+i),otherUser:{id:String(i),username:'peer'+i,fullName:'Peer '+i}}))};`,
  };
  const bundle = await build({ entryPoints: [path.resolve('tests/browser/profile.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env.APP_URL':'undefined', 'process.env.NEXT_PUBLIC_APP_URL': '"https://profile.test"' }, plugins: [{ name: 'isolated-profile', setup(b) {
    b.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
  } }, serverActionsPlugin] });
  script = bundle.outputFiles![0]!.text;
  const result = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  [instrumentFont,monoFont]=await Promise.all([readFile('src/app/fonts/InstrumentSans.woff2'),readFile('src/app/fonts/JetBrainsMono.woff2')]);
  css = `@font-face{font-family:'Instrument Sans';src:url('/instrument.ttf');font-weight:100 900;font-display:swap;}@font-face{font-family:'JetBrains Mono';src:url('/mono.ttf');font-weight:100 900;font-display:swap;}:root{--font-instrument-sans:'Instrument Sans';--font-jetbrains-mono:'JetBrains Mono';}`+result.css;
});

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error(`Profile fixture: ${error.stack ?? error.message}`));
  await page.route(`${origin}/**`, route => {
    const name = new URL(route.request().url()).pathname;
    if(name==='/instrument.ttf'||name==='/mono.ttf') return route.fulfill({contentType:'font/ttf',body:name==='/instrument.ttf'?instrumentFont:monoFont});
    if (name.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: name.includes('/skills') ? {skills:[]} : name.endsWith('/workspaces?limit=24') ? { projects: [], total: 0 } : name.includes('projects') ? { projects: [], total: 0 } : { summary: { projects: [], contributions: [], stats: { projectsCount: 0 } } } }) });
    return route.fulfill({ contentType: name === '/app.js' ? 'application/javascript' : name === '/app.css' ? 'text/css' : 'text/html', body: name === '/app.js' ? script : name === '/app.css' ? css : '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
  });
  await page.goto(origin);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByRole('switch', { name: 'Open to collaboration', exact: true })).toBeVisible();
});

test('header quick toggle saves only availability and preserves preferences through reload', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: 'Open to collaboration', exact: true });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  expect(await page.evaluate(() => Object.keys((window as any).profileFixture.calls[0]).sort())).toEqual(['expectedUpdatedAt', 'openToCollaborate']);
  await page.reload();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Paused — your preferences are saved.', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', {name:'Manage preferences',exact:true})).toHaveCount(0);
  await expect(page.getByText('Rust Developer', { exact: true })).toBeVisible();
});

test('the role card opens Collaboration preferences; draft switch and categories save together', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit role preferences', exact: true }).click();
  const dialog = page.getByRole('region', {name:'Edit profile',exact:true});
  await expect(dialog.getByRole('tab', { name: 'Collaboration' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('switch', { name: 'Open to collaboration', exact: true }).click();
  await dialog.getByRole('button', { name: 'Design', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Skills' }).click();
  await dialog.getByRole('tab', { name: 'Collaboration' }).click();
  await expect(dialog.getByRole('switch', { name: 'Open to collaboration', exact: true })).toBeChecked();
  expect(await page.evaluate(() => (window as any).profileFixture.calls.length)).toBe(0);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByText('Saved just now', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('switch', { name: 'Open to collaboration', exact: true })).toBeChecked();
  await expect(page.getByText('Design', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit role preferences', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Collaboration' })).toHaveAttribute('aria-selected', 'true');
});

test('discard preserves saved state; failed save preserves draft; header failures roll back', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit role preferences', exact: true }).click();
  const dialog = page.getByRole('region', {name:'Edit profile',exact:true});
  await dialog.getByRole('switch', { name: 'Open to collaboration', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Open to collaboration', exact: true })).not.toBeChecked();
  await page.evaluate(() => (window as any).profileFixture.fail = true);
  await page.getByRole('switch', { name: 'Open to collaboration', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Open to collaboration', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Edit role preferences', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Open to collaboration', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Open to collaboration', exact: true })).toBeChecked();
  await expect(dialog.getByText('Save failed', { exact: true })).toBeVisible();
});

test('pending save disables repeated actions; concurrent profile change explains failure', async ({ page }) => {
  await page.evaluate(() => { (window as any).profileFixture.delay = 500; (window as any).profileFixture.conflict = true; });
  const toggle = page.getByRole('switch', { name: 'Open to collaboration', exact: true });
  await toggle.click();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Your profile changed in another session. Refresh and try again.', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).profileFixture.calls.length)).toBe(1);
});

test('connections show authoritative total independently of paging/search and distinguish failure', async ({ page }) => {
  await page.getByRole('button', { name: 'View 2 connections', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText("Builder's Connections (42)");
  await expect(dialog.getByText('30 of 42 connections shown')).toBeVisible();
  await dialog.getByRole('button', { name: 'Load more' }).click();
  await expect(dialog.getByText('42 of 42 connections shown')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search connections' }).fill('Peer');
  await expect(dialog.getByText('1 matching connections shown')).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText("Builder's Connections (42)");
  await page.evaluate(() => (window as any).profileFixture.listFail = true);
  await dialog.getByRole('textbox', { name: 'Search connections' }).fill('fail');
  await expect(dialog.getByRole('alert')).toHaveText('Connection service unavailable');
  await expect(dialog.getByText('No connections yet')).not.toBeVisible();
});

test('visitors see saved availability but cannot edit; paused and locked profiles hide opportunity card', async ({ page }) => {
  await page.evaluate(() => { const f=(window as any).profileFixture; f.viewer=true;f.saved.openToCollaborate=true;f.refresh(); });
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Collaboration', exact: true })).toBeVisible();
  await expect(page.getByText('Rust Developer', { exact: true })).toBeVisible();
  await page.evaluate(() => { const f=(window as any).profileFixture; f.saved.openToCollaborate=false;f.refresh(); });
  await expect(page.locator('#profile-open-to-roles')).toHaveCount(0);
  await page.evaluate(() => { const f=(window as any).profileFixture; f.saved.openToCollaborate=true;f.locked=true;f.refresh(); });
  await expect(page.locator('#profile-open-to-roles')).toHaveCount(0);
  await expect(page.locator('[data-status="completed"]')).toHaveCount(0);
});


test('mobile preferences save custom roles without overflow; new users can enable general collaboration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { const f=(window as any).profileFixture; Object.assign(f.saved, {openTo:[],openToCustomRoles:[],preferredCategories:[],experienceLevel:null,hoursPerWeek:null}); f.refresh(); });
  await page.getByRole('switch', { name: 'Open to collaboration', exact: true }).click();
  await expect(page.getByRole('switch', {name:'Open to collaboration',exact:true})).toBeChecked();
  await expect(page.getByText('Add the role types, roles, and categories that interest you.', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Edit role preferences',exact:true}).click();
  const dialog=page.getByRole('region', {name:'Edit profile',exact:true});
  await expect(dialog.getByRole('tab', {name:'Collaboration'})).toHaveAttribute('aria-selected','true');
  await dialog.getByPlaceholder('e.g. Next.js developer, Rust developer').fill('Game developer');
  await dialog.getByRole('button', {name:'Add role',exact:true}).click();
  await dialog.getByRole('button', {name:'Save changes',exact:true}).click();
  await expect(dialog.getByText('Saved just now',{exact:true})).toBeVisible();
  await dialog.getByRole('button', {name:'Done',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Game developer',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('editor conflict keeps preferences draft available for review', async ({ page }) => {
  await page.getByRole('button', {name:'Edit role preferences',exact:true}).click();
  const dialog=page.getByRole('region', {name:'Edit profile',exact:true});
  await dialog.getByRole('button', {name:'Design',exact:true}).click();
  await page.evaluate(()=>{const f=(window as any).profileFixture; f.conflict=true;f.saved.headline='Updated elsewhere';f.saved.hoursPerWeek='h_20_40';f.saved.updatedAt=new Date(Date.now()).toISOString();});
  await dialog.getByRole('button', {name:'Save changes',exact:true}).click();
  await expect(dialog.getByText('Your profile changed in another session. Review the latest changes before saving again.',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Design',exact:true})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'Review latest changes',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Design',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{(window as any).profileFixture.conflict=false;});
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog.getByText('Saved just now',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Updated elsewhere',{exact:true})).toBeVisible();
  const payload=await page.evaluate(()=>(window as any).profileFixture.calls.at(-1));
  expect(payload).not.toHaveProperty('headline');
  expect(payload).not.toHaveProperty('hoursPerWeek');
});

test('role preference values share one column and stay aligned in narrow cards', async ({ page }) => {
  await page.evaluate(() => {
    const f=(window as any).profileFixture;
    Object.assign(f.saved,{openTo:['Part-time roles','Contract roles'],openToCustomRoles:['SpecializedDeveloperWithALongRoleName'],preferredCategories:['Design','Engineering'],experienceLevel:'student',hoursPerWeek:'lt_5'});
    f.refresh();
  });
  const card=page.locator('#profile-open-to-roles');
  await expect(card.getByRole('heading')).toHaveText('Collaboration');
  await expect(card.locator('.nb-tag')).toHaveCount(0);
  await expect(card.getByText('<5 h/week',{exact:true})).toBeVisible();
  await expect(card.getByText('Less than 5 hours a week',{exact:true})).toHaveClass('sr-only');
  await expect(card.locator('dt')).toHaveText(['Role types','Preferred roles','Categories','Experience','Weekly availability']);
  for(const width of [320,280]) {
    await card.evaluate((el,w)=>{el.style.width=`${w}px`;},width);
    const positions=await card.locator('dl > div').evaluateAll(rows=>rows.map(row=>{
      const label=row.querySelector('dt')!.getBoundingClientRect();
      const value=row.querySelector('dd')!.getBoundingClientRect();
      const textRights=Array.from(row.querySelectorAll('li > span:not(.sr-only)')).map(span=>{
        const range=document.createRange();
        range.selectNodeContents(span);
        return Math.max(...Array.from(range.getClientRects()).map(rect=>rect.right));
      });
      return {labelX:label.x,labelTop:label.y,valueX:value.x,valueTop:value.y,valueRight:value.right,textRights};
    }));
    for(const pos of positions) {
      expect(pos.labelX).toBeCloseTo(positions[0]!.labelX,0);
      expect(pos.valueX).toBeCloseTo(positions[0]!.valueX,0);
      // items-start: when a value wraps, its label stays on the first line
      expect(pos.labelTop).toBeCloseTo(pos.valueTop,0);
      if(pos.textRights.length) expect(Math.max(...pos.textRights)).toBeCloseTo(pos.valueRight,0);
    }
    expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await card.evaluate(el=>{el.style.width='';});
  await page.evaluate(()=>{const f=(window as any).profileFixture;Object.assign(f.saved,{openTo:['Part-time roles'],openToCustomRoles:[],preferredCategories:['Design']});f.refresh();});
  await expect(card.locator('dt')).toHaveText(['Role types','Categories','Experience','Weekly availability']);
  await card.screenshot({path:'/tmp/nb-role-preferences-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Manage preferences',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await card.screenshot({path:'/tmp/nb-role-preferences-mobile.png'});
});

test('profile tabs: Overview, Contributions and Portfolio with counts, arrow keys, and no vertical scroll', async ({page}) => {
  const tabs=page.getByRole('tablist',{name:'Profile sections'});
  const overview=tabs.getByRole('tab',{name:/^Overview/});
  const contributions=tabs.getByRole('tab',{name:/^Contributions/});
  const portfolio=tabs.getByRole('tab',{name:/^Portfolio/});
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(contributions.locator('.n')).toHaveText(/^\d+$/);
  for(const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:900});
    const overflow=await tabs.evaluate(el=>{ const style=getComputedStyle(el); el.scrollTop=100; return {y:style.overflowY==='visible'||style.overflowY==='hidden'||el.scrollTop===0}; });
    expect(overflow).toEqual({y:true});
    await portfolio.click();
    await expect(portfolio).toHaveAttribute('aria-selected','true');
    await expect(page).toHaveURL(/tab=portfolio/);
    await portfolio.press('ArrowLeft');
    await expect(contributions).toBeFocused();
    await expect(contributions).toHaveAttribute('aria-selected','true');
    await contributions.press('ArrowLeft');
    await expect(overview).toHaveAttribute('aria-selected','true');
  }
  await page.goto(origin + '/?tab=contributions');
  await expect(page.getByRole('tab',{name:/^Contributions/})).toHaveAttribute('aria-selected','true');
});

test('skills fold after twelve; About is plain body text with a fold and an owner pencil', async ({page}) => {
  await page.evaluate(()=>{
    const f=(window as any).profileFixture;
    Object.assign(f.saved,{skills:Array.from({length:25},(_,i)=>`Skill ${i+1}`),bio:'First paragraph about my work.\n\nSecond paragraph. '+'More words to make it long. '.repeat(20)});
    f.refresh();
  });
  const strip=page.getByLabel('Skills',{exact:true});
  await expect(strip.locator('.nb-pf-chip:not(.is-more)')).toHaveCount(12);
  await strip.getByRole('button',{name:'+13 more'}).click();
  await expect(strip.locator('.nb-pf-chip:not(.is-more)')).toHaveCount(25);
  const about=page.locator('[data-pf-about]');
  const family=await about.locator('p').first().evaluate(el=>getComputedStyle(el).fontFamily);
  expect(family).not.toMatch(/Instrument Serif|Georgia/i);
  await expect(about.getByRole('button',{name:'Read more'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit about in Edit profile'})).toBeVisible();
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.viewer=true;f.refresh();});
  await expect(page.getByRole('button',{name:'Edit about in Edit profile'})).toHaveCount(0);
});

const entry = (i: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, projectId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`, version: 1,
  title: 'Tester', projectTitle: `Workspace ${i}`, projectHref: `/workspaces/w${i}`, repoUrl: null, description: `Story ${i}.`,
  startDate: `2026-${String((i % 9) + 1).padStart(2, '0')}-01`, endDate: null, currentlyActive: true, skills: [], source: 'membership', verified: false,
  visibility: 'public', publishedAt: '2026-10-01T00:00:00Z', projectKind: 'workspace', featured: false, ...over,
});

test('contributions tab: filters with counts, a timeline that pages by ten, owner and visitor menus', async ({page}) => {
  await page.evaluate((list) => { const f=(window as any).profileFixture; f.contributions=list; f.refresh(); }, [
    entry(1, { featured: true }), entry(2, { projectKind: 'organization', projectTitle: 'Org One', orgVerified: true }),
    entry(3, { projectId: null, projectHref: null, projectTitle: 'Outside thing' }), entry(4, { visibility: 'private' }),
    ...Array.from({ length: 10 }, (_, k) => entry(10 + k)),
  ]);
  await page.getByRole('tab',{name:/^Contributions/}).click();
  const panel=page.locator('#profile-panel-contributions');
  const filters=panel.getByRole('group',{name:'Show contributions'});
  await expect(filters.getByRole('button',{name:/^All/})).toContainText('14');
  await expect(panel.locator('.nb-pf-tli')).toHaveCount(10);
  await panel.getByRole('button',{name:/^Show 4 more/}).click();
  await expect(panel.locator('.nb-pf-tli')).toHaveCount(14);
  await expect(panel.locator('.nb-pf-tli').first()).toContainText('Workspace 1');
  await expect(panel.locator('.nb-pf-tli.is-hidden')).toHaveCount(1);
  await filters.getByRole('button',{name:/^Organizations/}).click();
  await expect(panel.locator('.nb-pf-tli')).toHaveCount(1);
  await expect(panel.locator('.nb-pf-tli')).toContainText('Verified');
  await filters.getByRole('button',{name:/^All/}).click();
  await panel.getByRole('button',{name:'More for Workspace 16'}).click();
  for (const item of ['Pin to the top','Hide from profile','Edit']) await expect(page.getByRole('menuitem',{name:item})).toBeVisible();
  await page.getByRole('menuitem',{name:'Pin to the top'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).profileFixture.storyCalls.at(-1)?.operation)).toBe('feature');
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.viewer=true;f.refresh();});
  await expect(panel.locator('.nb-pf-tli.is-hidden')).toHaveCount(0);
  await panel.getByRole('button',{name:'More for Workspace 16'}).click();
  await expect(page.getByRole('menuitem',{name:/Report/})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Pin to the top'})).toHaveCount(0);
});

test('overview: Recent work shows the pinned entry and the newest, with See all', async ({page}) => {
  await page.evaluate((list) => { const f=(window as any).profileFixture; f.contributions=list; f.refresh(); }, [entry(1), entry(2, { featured: true }), entry(3)]);
  const recent=page.locator('#profile-panel-overview');
  await expect(recent.getByText(/Recent work/)).toBeVisible();
  await expect(recent.locator('.nb-pf-tli')).toHaveCount(2);
  await expect(recent.locator('.nb-pf-tli').first()).toContainText('Workspace 2');
  await recent.getByRole('button',{name:/See all 3 contributions/}).click();
  await expect(page.getByRole('tab',{name:/^Contributions/})).toHaveAttribute('aria-selected','true');
});

test('the right card is ordered by who is looking; owner-only parts stay with the owner', async ({page}) => {
  await page.evaluate(()=>{
    const f=(window as any).profileFixture;
    Object.assign(f.saved,{openToCollaborate:true,profileStrength:60,completionMissing:['Add profile photo','Add location','Add website'],
      socialLinks:[{id:'l1',platform:'github',url:'https://github.com/builder'},{id:'l2',platform:'linkedin',url:'https://www.linkedin.com/in/builder'}],
      socialLinkMetadata:{l2:{health:'unavailable'}}});
    f.refresh();
  });
  const card=page.getByRole('complementary',{name:'Details'});
  await expect(card.locator('.nb-pf-fsec').first().getByRole('heading')).toHaveText('Profile completeness');
  await expect(card.getByRole('button',{name:/Add profile photo/})).toBeVisible();
  await expect(card.getByText('Didn’t open last time')).toBeVisible();
  await card.getByRole('button',{name:'Fix LinkedIn'}).click();
  await expect(page).toHaveURL(/section=social/);
  await page.goBack();
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.viewer=true;f.refresh();});
  await expect(card.locator('.nb-pf-fsec').first().getByRole('heading')).toHaveText('Collaboration');
  await expect(card.getByRole('button',{name:'Invite to a workspace'})).toBeVisible();
  await expect(card.getByRole('heading',{name:'Profile completeness'})).toHaveCount(0);
  await expect(card.getByText('Didn’t open last time')).toHaveCount(0);
});

test('portfolio: filter by own or member, sort by recent or name, with your role on each card', async ({page}) => {
  const ws = (i: number, over: Record<string, unknown> = {}) => ({ kind: 'workspace', id: `20000000-0000-4000-8000-${String(i).padStart(12,'0')}`, ownerId: '99999999-9999-4999-8999-999999999999',
    title: `Project ${String.fromCharCode(64 + i)}`, slug: `p${i}`, description: 'A project.', shortDescription: null, coverImage: null, href: `/workspaces/p${i}`, image: null, url: `/workspaces/p${i}`,
    members: [], userRole: 'Tester', roleKind: 'member', joinedAt: null, createdAt: null, updatedAt: `2026-11-${String(10 + i).padStart(2,'0')}T00:00:00Z`, viewCount: 3, followersCount: 0,
    category: null, visibility: 'public', contributionVisibility: 'public', status: 'active', skills: [], tags: [], verified: false, ...over });
  await page.evaluate((list) => { const f=(window as any).profileFixture; f.projects=list; f.refresh(); }, [ws(1), ws(2, { ownerId: '11111111-1111-4111-8111-111111111111', userRole: 'Owner' }), ws(3)]);
  await page.getByRole('tab',{name:/^Portfolio/}).click();
  const panel=page.locator('#profile-panel-portfolio');
  const filters=panel.getByRole('group',{name:'Show workspaces'});
  await expect(filters.getByRole('button',{name:/^All/})).toContainText('3');
  await expect(panel.locator('[data-pf-wrole]').first()).toContainText('Project C');
  await panel.getByRole('button',{name:'Name'}).click();
  await expect(panel.locator('[data-pf-wrole]').first()).toContainText('Project A');
  await filters.getByRole('button',{name:/^I own/}).click();
  await expect(panel.locator('[data-pf-wrole]')).toHaveCount(1);
  await expect(panel.locator('[data-pf-wrole]').first()).toContainText('Owner');
  await filters.getByRole('button',{name:/^Member/}).click();
  await expect(panel.locator('[data-pf-wrole]')).toHaveCount(2);
});

test('owner band: status sits in the row with Change; the band never scrolls sideways', async ({ page }) => {
  await page.evaluate(()=>{
    const f=(window as any).profileFixture;
    Object.assign(f.saved,{location:'Vijayawada, Andhra Pradesh, India',website:'https://builder.dev'});
    f.refresh();
  });
  const header=page.getByTestId('profile-summary-header');
  const status=header.getByRole('button',{name:'Set a status',exact:true});
  for(const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:900});
    await expect(status).toBeVisible();
    const avatar=(await header.locator('.nb-pf-photo').boundingBox())!;
    const row=(await header.locator('.nb-pf-row').boundingBox())!;
    expect(row.y).toBeGreaterThanOrEqual(avatar.y+avatar.height-1);
    expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await status.click();
  expect(await page.evaluate(()=>(window as any).profileFixture.pickerOpen)).toBe(true);
  await page.evaluate(()=>{
    const f=(window as any).profileFixture;
    f.presence={availability:'later',availabilityText:'Available later',status:{emoji:'💻'},statusText:'Working on a detailed design review with my project collaborators'};
    f.refresh();
  });
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await expect(header.getByText(/Working on a detailed design review with my project collaborators/)).toBeVisible();
    await expect(header.getByRole('button',{name:'Change status',exact:true})).toBeVisible();
    expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.viewer=true;f.refresh();});
  await expect(header.getByRole('button',{name:/^(Set a status|Change status)$/})).toHaveCount(0);
  await header.getByRole('button',{name:'Connect options',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'Message Builder'})).toBeVisible();
});

test('a long name and headline drop the headline under the photo, so no space is left beside it', async ({ page }) => {
  await page.evaluate(()=>{
    const f=(window as any).profileFixture;
    Object.assign(f.saved,{fullName:'Venkata Lakshmi Narasimha Subrahmanyam Chaganti-Rodrigues',headline:'Staff engineer building developer tools, CI pipelines and review queues for university teams across three campuses'});
    f.refresh();
  });
  const header=page.getByTestId('profile-summary-header');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await expect(header).toHaveClass(/is-tall/);
    const photo=(await header.locator('.nb-pf-photo').boundingBox())!;
    const headline=(await header.locator('.nb-pf-headline').boundingBox())!;
    expect(headline.y).toBeGreaterThanOrEqual(photo.y+photo.height-1);
    expect(Math.abs(headline.x-photo.x)).toBeLessThanOrEqual(1);
    expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await page.evaluate(()=>{const f=(window as any).profileFixture;Object.assign(f.saved,{fullName:'Builder',headline:'Engineer'});f.refresh();});
  await page.setViewportSize({width:1440,height:900});
  await expect(header).not.toHaveClass(/is-tall/);
});

test('visitor actions: the connection control, then Share, then ⋯ on one row; Message in the permitted dropdown', async ({page}) => {
  const header = page.getByTestId('profile-summary-header');
  for (const state of ['accepted', 'none', 'pending_outgoing', 'pending_incoming'] as const) {
    await page.evaluate(state => {
      const f = (window as any).profileFixture;
      f.viewer = true; f.connectionStatus = state; f.refresh();
    }, state);
    const label = state === 'accepted' ? 'Connected' : state === 'pending_outgoing' ? 'Requested' : state === 'pending_incoming' ? 'Accept' : 'Connect';
    const control = header.getByRole('button', {name: `${label} options`, exact: true});
    const share = header.getByRole('button', {name: 'Share profile', exact: true});
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      await expect(control).toBeVisible();
      const shareRect = (await share.boundingBox())!;
      const controlRect = (await control.boundingBox())!;
      expect(Math.abs(shareRect.y - controlRect.y)).toBeLessThanOrEqual(6);
      expect(shareRect.x).toBeGreaterThan(controlRect.x + controlRect.width - 1);
      expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await control.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', {name: 'Message Builder', exact: true})).toBeVisible();
    for (const item of state === 'accepted' ? ['Disconnect'] : state === 'pending_outgoing' ? ['Cancel request'] : state === 'pending_incoming' ? ['Accept', 'Decline'] : ['Connect']) {
      await expect(menu.getByRole('menuitem', {name: item, exact: true})).toBeVisible();
    }
    await menu.getByRole('menuitem', {name: 'Message Builder', exact: true}).click();
    await expect(menu).toHaveCount(0);
    // Block lives in the person's own menu, for every connection state (Blocking B6).
    await header.getByRole('button', {name: 'More actions for Builder', exact: true}).click();
    await expect(page.getByRole('menuitem', {name: 'Block Builder', exact: true})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(await page.evaluate(() => (window as any).profileFixture.messaged.length)).toBe(4);
  await page.evaluate(() => { const f = (window as any).profileFixture; f.canMessage = false; f.refresh(); });
  await header.getByRole('button', {name: 'Accept options', exact: true}).click();
  await expect(page.getByRole('menuitem', {name: 'Message Builder', exact: true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const f = (window as any).profileFixture; f.connectionStatus = 'none'; f.canMessage = true; f.canConnect = false; f.refresh(); });
  await header.getByRole('button', {name: 'Actions options', exact: true}).click();
  await expect(page.getByRole('menuitem', {name: 'Message Builder', exact: true})).toBeVisible();
  await expect(page.getByRole('menuitem', {name: 'Connect', exact: true})).toHaveCount(0);
});

test('visitor status sits in the band row; long status wraps; locked profiles show none', async ({page}) => {
  await page.evaluate(()=>{
    const f=(window as any).profileFixture;
    f.viewer=true;
    f.saved.openToCollaborate=true;
    f.presence={availability:'offline',availabilityText:'Offline',status:{emoji:'💻'},statusText:'Building something new'};
    f.refresh();
  });
  const header=page.getByTestId('profile-summary-header');
  const status=header.locator('[data-profile-status]');
  await expect(status).toHaveText('💻Building something new');
  await expect(header.getByText('Open to collaborate',{exact:true})).toBeVisible();
  await expect(header.locator('.nb-pf-row [data-profile-status]')).toHaveCount(1);
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.presence.statusText='SpecializedDeveloperWithALongUnbrokenPersonalStatusThatMustWrapWithinTheProfileCard';f.refresh();});
  for(const width of [1024,390,320]) {
    await page.setViewportSize({width,height:900});
    await expect(status).toBeVisible();
    expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.locked=true;f.refresh();});
  await expect(status).toHaveCount(0);
  await expect(header.locator('.nb-pf-lock')).toBeVisible();
  await expect(page.locator('[data-pf-tabbar]')).toHaveCount(0);
});

test('visitor role actions fit the rail and have a full touch target', async ({page}) => {
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.viewer=true;f.saved.openToCollaborate=true;f.refresh();});
  const card=page.locator('#profile-open-to-roles');
  const action=card.getByRole('button',{name:'Invite to a workspace',exact:true});
  await expect(action).toBeVisible();
  for(const width of [320,280]) {
    await card.evaluate((el,w)=>{el.style.width=`${w}px`;},width);
    const bounds=await action.boundingBox();
    const data=await card.locator('dl').boundingBox();
    expect(bounds!.width).toBeCloseTo(data!.width,0);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(await action.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
});


test('edit profile uses a full page, preserves section links on refresh and keeps one draft across tabs',async({page})=>{
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});await expect(editor).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(/\/my-profile\/edit\?section=general/);
  const bounds=await editor.boundingBox();expect(bounds!.y).toBe(56);expect(bounds!.y+bounds!.height).toBe(1000);
  await editor.getByRole('tab',{name:'Collaboration'}).click();await expect(page).toHaveURL(/section=opportunity/);await page.reload();await expect(editor.getByRole('tab',{name:'Collaboration'})).toHaveAttribute('aria-selected','true');
  await editor.getByRole('button',{name:'Design',exact:true}).click();await editor.getByRole('tab',{name:'Skills'}).click();await editor.getByRole('tab',{name:'Collaboration'}).click();await expect(editor.getByRole('button',{name:'Design',exact:true})).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>(window as any).profileFixture.calls.length)).toBe(0);
});

test('edit profile: typing updates the preview, lists the change with its own Undo, dots the tab, and ⌘S saves in place',async({page})=>{
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const preview=editor.getByRole('region',{name:'Preview of your profile header'});
  const card=editor.getByRole('complementary',{name:'Your changes'});
  await expect(card.getByText('Everything is saved')).toBeVisible();
  await expect(preview.getByText('Click anything above to edit it')).toBeVisible();
  await editor.locator('#profile-headline').fill('Builds compilers for fun');
  await expect(preview.getByRole('button',{name:'Builds compilers for fun'})).toBeVisible();
  await expect(card.getByText('1 unsaved change',{exact:true})).toBeVisible();

  await expect(card.getByRole('button',{name:/^Headline\s*Edited/})).toBeVisible();
  await expect(card.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
  await expect(editor.getByRole('tab',{name:/^Details/}).locator('.dot')).toHaveCount(1);
  await card.getByRole('button',{name:'Undo Headline'}).click();
  await expect(card.getByText('Everything is saved')).toBeVisible();
  await expect(preview.getByRole('button',{name:'Builds compilers for fun'})).toHaveCount(0);
  await expect(editor.getByRole('tab',{name:/^Details/}).locator('.dot')).toHaveCount(0);
  await preview.getByRole('button',{name:'Builder',exact:true}).click();
  await expect(editor.locator('#profile-full-name')).toBeFocused();
  await editor.locator('#profile-headline').fill('Builds compilers');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(card.getByText('Saved just now')).toBeVisible();
  await expect(page).toHaveURL(/\/my-profile\/edit/);
  expect(await page.evaluate(()=>(window as any).profileFixture.calls.at(-1).headline)).toBe('Builds compilers');
});

test('details: a taken username offers names to try and asks before changing; the website gets https on blur; photo errors explain themselves',async({page})=>{
  await page.evaluate(()=>{(window as any).profileFixture.takenUsernames=['taken_name'];});
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const card=editor.getByRole('complementary',{name:'Your changes'});
  for(const label of ['Photo','Identity','About','Private details']) await expect(editor.getByRole('heading',{name:label,exact:true})).toBeVisible();
  await expect(editor.getByText('Only you',{exact:true}).first()).toBeVisible();
  await editor.locator('#profile-username').fill('taken_name');
  await expect(editor.getByText('@taken_name is taken.')).toBeVisible();
  await expect(card.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await editor.getByRole('button',{name:'@taken_name1',exact:true}).click();
  await expect(editor.locator('#profile-username')).toHaveValue('taken_name1');
  await expect(editor.locator('#profile-username-hint')).toContainText('Available.');
  await expect(editor.locator('#profile-username-hint')).toContainText('builder → taken_name1');
  await editor.locator('#profile-website').fill('example.com');await editor.locator('#profile-website').blur();
  await expect(editor.locator('#profile-website')).toHaveValue('https://example.com');
  await editor.locator('#profile-bio').fill('First paragraph.\n\nSecond paragraph.');
  await expect(editor.getByTestId('about-preview').locator('p')).toHaveCount(2);
  await card.getByRole('button',{name:'Save changes',exact:true}).click();
  const ask=page.getByRole('alertdialog',{name:'Change your username to @taken_name1?'});
  await expect(ask).toContainText('You can’t change it again until');
  await ask.getByRole('button',{name:'Keep @builder',exact:true}).click();
  await expect(card.getByText('Saved just now')).toBeVisible();
  const last=await page.evaluate(()=>(window as any).profileFixture.calls.at(-1));
  expect(last.website).toBe('https://example.com');expect(last).not.toHaveProperty('username');
  await editor.locator('input[type=file]').setInputFiles({name:'big.png',mimeType:'image/png',buffer:Buffer.alloc(3.4*1024*1024)});
  await expect(editor.getByRole('alert').filter({hasText:'That photo is 3.4 MB. Choose one under 2 MB.'})).toBeVisible();
  await editor.locator('input[type=file]').setInputFiles({name:'a.gif',mimeType:'image/gif',buffer:Buffer.alloc(10)});
  await expect(editor.getByRole('alert').filter({hasText:'That’s a GIF. Use a JPG, PNG or WebP photo.'})).toBeVisible();
});

test('skills move with ← →; links refuse a duplicate, offer Fix on a broken one, and removal can be undone',async({page})=>{
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.saved={...f.saved,skills:['React','Figma','Rust'],socialLinks:[{id:'github',platform:'github',url:'https://github.com/builder',order:0},{id:'site',platform:'website',url:'https://builder.dev',order:1}],socialLinkMetadata:{site:{health:'unavailable'}}};sessionStorage.setItem('profile',JSON.stringify(f.saved));});
  await page.goto(origin+'/my-profile/edit?section=skills');
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const card=editor.getByRole('complementary',{name:'Your changes'});
  const chips=editor.locator('[aria-label="Selected skills"] [data-reorder]');
  await expect(chips).toHaveText(['React','Figma','Rust']);
  await chips.nth(1).focus();await page.keyboard.press('ArrowLeft');
  await expect(chips).toHaveText(['Figma','React','Rust']);
  await expect(chips.first()).toBeFocused();
  await expect(card.getByRole('button',{name:/^Skills\s*Reordered/})).toBeVisible();
  await editor.getByRole('tab',{name:/^Links/}).click();
  await expect(editor.getByRole('heading',{name:'Your public links',exact:true})).toBeVisible();
  await expect(editor.getByText('Needs update · this link didn’t open last time')).toBeVisible();
  await editor.getByRole('button',{name:'Fix',exact:true}).click();
  await expect(editor.locator('#profile-social-url')).toHaveValue('https://builder.dev');
  await expect(editor.getByRole('heading',{name:'Edit link',exact:true})).toBeVisible();
  await editor.getByRole('button',{name:'Cancel',exact:true}).first().click();
  await editor.locator('#profile-social-url').fill('https://github.com/builder/');
  await expect(editor.getByText('You already have this link.')).toBeVisible();
  await expect(editor.getByRole('button',{name:'Add link',exact:true})).toBeDisabled();
  await editor.getByRole('button',{name:'Remove GitHub',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Remove GitHub',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Remove GitHub',exact:true})).toBeVisible();
});

test('collaboration: a picked 17th category shows while folded; off dims the panels; Clear all can be undone',async({page})=>{
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.saved={...f.saved,openToCollaborate:true,preferredCategories:['Quality Assurance'],openToCustomRoles:['Rust developer']};sessionStorage.setItem('profile',JSON.stringify(f.saved));});
  await page.goto(origin+'/my-profile/edit?section=opportunity');
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  for(const label of ['Availability','Role types','Categories','Preferred roles']) await expect(editor.getByRole('heading',{name:label,exact:true})).toBeVisible();
  await expect(editor.getByRole('button',{name:'Quality Assurance',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(editor.getByRole('button',{name:'People and HR',exact:true})).toHaveCount(0);
  await editor.getByRole('button',{name:'Show all 17',exact:true}).click();
  await expect(editor.getByRole('button',{name:'People and HR',exact:true})).toBeVisible();
  await expect(editor.getByText('Suggestions',{exact:true})).toBeVisible();
  await expect(editor.getByText('Open to collaborate',{exact:true}).first()).toBeVisible();
  await editor.getByRole('switch',{name:'Open to collaboration',exact:true}).click();
  await expect(editor.getByText('You’re not open to collaboration, so these don’t show. They’re kept for when you turn it back on.')).toBeVisible();
  await editor.getByRole('button',{name:'Clear all preferences',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Remove desired role Rust developer'})).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Remove desired role Rust developer'})).toBeVisible();
});

test('dirty drafts warn on browser Back, keep editing on cancel, and leave on confirmation',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();
  await page.evaluate(()=>history.back());const ask=page.getByRole('alertdialog',{name:'Discard unsaved changes?'});await expect(ask).toBeVisible();await ask.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(ask).toHaveCount(0);await expect(page).toHaveURL(/\/my-profile\/edit/);await expect(editor.getByRole('button',{name:'Design',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>history.back());await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).getByRole('button',{name:'Discard and leave',exact:true}).click();await expect(editor).not.toBeVisible();await expect(page.getByRole('switch',{name:'Open to collaboration',exact:true})).toBeVisible();
});

test('dirty drafts protect sidebar navigation and refresh; pristine cancel returns without a warning',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();
  expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})).toBe(true);
  await page.getByRole('link',{name:'Network',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).getByRole('button',{name:'Keep editing',exact:true}).click();await expect(editor).toBeVisible();
  await editor.getByRole('button',{name:'Reset',exact:true}).click();expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})).toBe(false);await editor.getByRole('button',{name:'Done',exact:true}).click();await expect(page).toHaveURL(/\/my-profile$/);
});

test('Discard and leave on a plain link follows that link',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();
  await page.getByRole('link',{name:'Network',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).getByRole('button',{name:'Discard and leave',exact:true}).click();await expect(page).toHaveURL(/\/network$/);
});

test('editor: preview band, then the tab bar, the form beside the Changes card, and no sideways scroll',async({page})=>{
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const preview=editor.getByRole('region',{name:'Preview of your profile header'});
  const tablist=editor.getByRole('tablist',{name:'Profile edit sections'});
  const card=editor.getByRole('complementary',{name:'Your changes'});
  const panel=editor.getByRole('tabpanel');
  expect(await editor.getByRole('tab').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringMatching(/^Details/),expect.stringMatching(/^Contributions/),expect.stringMatching(/^Skills/),expect.stringMatching(/^Links/),expect.stringMatching(/^Collaboration/)]));
  const [pv,tl,cd,pn]=await Promise.all([preview.boundingBox(),tablist.boundingBox(),card.boundingBox(),panel.boundingBox()]);
  expect(tl!.y).toBeGreaterThanOrEqual(pv!.y+pv!.height-2);
  expect(cd!.x).toBeGreaterThanOrEqual(pn!.x+pn!.width);
  expect(Math.abs(cd!.y-pn!.y)).toBeLessThan(40);
  await editor.getByRole('tab',{name:'Details'}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(editor.getByRole('tab',{name:'Contributions'})).toBeFocused();
  await expect(page).toHaveURL(/section=experience/);
  await editor.getByRole('tab',{name:'Details'}).click();
  for(const width of [1440,1024,768,320]) {
    await page.setViewportSize({width,height:1000});
    expect(await editor.locator('[data-scroll-root="route"]').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
  const [pn2,cd2]=await Promise.all([panel.boundingBox(),card.boundingBox()]);
  expect(cd2!.y).toBeGreaterThanOrEqual(pn2!.y+pn2!.height);
});

test('editor keeps save controls visible on mobile and does not create horizontal scrolling',async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const bar=editor.getByRole('region',{name:'Save',exact:true});
  await expect(bar).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await editor.getByRole('tab',{name:'Skills'}).focus();await page.keyboard.press('ArrowRight');await expect(editor.getByRole('tab',{name:'Links'})).toBeFocused();
  await editor.getByRole('tab',{name:'Collaboration'}).click();
  await editor.getByRole('button',{name:'Design',exact:true}).click();
  const assertReachable=async()=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    for(const button of await bar.getByRole('button').all()) await expect(button).toBeInViewport();
    const b=await bar.boundingBox();expect(b!.y+b!.height).toBeLessThanOrEqual(740);
  };
  await expect(bar).toContainText('1 unsaved');await expect(bar).toContainText('Collaboration');
  await assertReachable();
  await page.evaluate(()=>(window as any).profileFixture.fail=true);
  await bar.getByRole('button',{name:'Save',exact:true}).click();
  await expect(editor.getByRole('alert').first()).toContainText('Save failed');
  await assertReachable();
  await bar.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(bar).toHaveCount(0);
});

test('pending editor saves block repeated writes and finish on the page',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();await page.evaluate(()=>{(window as any).profileFixture.delay=500;});await editor.getByRole('button',{name:'Save changes',exact:true}).click();await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await expect(editor.getByText('Saved just now',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).profileFixture.calls.length)).toBe(1);
});

test('deep links reject invalid section names and editing cannot continue under a different account',async({page})=>{
  await page.goto(origin+'/my-profile/edit?section=not-a-section');const editor=page.getByRole('region',{name:'Edit profile',exact:true});await expect(editor.getByRole('tab',{name:'Details'})).toHaveAttribute('aria-selected','true');
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.actorId='22222222-2222-4222-8222-222222222222';f.refresh();});await expect(page.getByRole('alert')).toContainText('different account');await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);
});

test('portfolio edit links return to portfolio without changing the selected profile view',async({page})=>{
  await page.getByRole('tab',{name:/^Portfolio/}).click();await page.getByTestId('profile-summary-header').getByRole('button',{name:'Edit profile',exact:true}).click();await expect(page).toHaveURL(/returnTab=portfolio/);await page.getByRole('region',{name:'Edit profile',exact:true}).getByRole('button',{name:'Done',exact:true}).click();await expect(page).toHaveURL(origin+'/my-profile?tab=portfolio');await expect(page.getByRole('tab',{name:/^Portfolio/})).toHaveAttribute('aria-selected','true');
});


test('programmatic search navigation uses the same unsaved profile guard',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Open search result',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).getByRole('button',{name:'Keep editing',exact:true}).click();await expect(editor.getByRole('button',{name:'Design',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Open search result',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).getByRole('button',{name:'Discard and leave',exact:true}).click();await expect(page.getByRole('heading',{name:'Network destination'})).toBeVisible();
});

test('editor typography, control density and selection colors follow the design tokens',async({page})=>{
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const font=async(locator:ReturnType<typeof page.locator>)=>locator.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,`${Math.round(parseFloat(s.lineHeight)*100)/100}px`,s.fontWeight,s.fontFamily];});
  await expect(editor.getByRole('heading',{name:'Edit profile',exact:true})).toHaveClass(/sr-only/);
  for(const label of ['Photo','Identity','About','Private details']) await expect(editor.getByRole('heading',{name:label,exact:true})).toBeVisible();
  expect((await font(editor.locator('label[for="profile-full-name"]'))).slice(0,3)).toEqual(['13px','15.6px','500']);
  expect((await font(editor.getByLabel('Full name',{exact:false}))).slice(0,2)).toEqual(['15px','22.5px']);
  expect(await font(editor.locator('#profile-full-name-count'))).toEqual(['12px','16.2px','400','"JetBrains Mono", monospace']);
  await expect(editor.locator('#profile-username-url')).toHaveText('profile.test/u/');
  for(const dark of [false,true]) for(const [density,height] of [['compact',30],['default',34],['comfortable',42]] as const) {
    await page.evaluate(({dark,density})=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.dataset.density=density;},{dark,density});
    await editor.getByRole('tab',{name:'Details'}).click();
    expect((await editor.getByLabel('Full name',{exact:false}).boundingBox())!.height).toBe(height);
    await editor.getByRole('tab',{name:'Collaboration'}).click();
    expect((await editor.getByLabel('Experience level',{exact:true}).boundingBox())!.height).toBe(height);
    const selected=editor.getByRole('button',{name:'Engineering',exact:true});
    expect(await selected.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('3px');
    expect(await selected.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await editor.evaluate(el=>getComputedStyle(el).color));
  }
  await editor.getByRole('tab',{name:'Skills'}).click();
  await editor.getByRole('button',{name:'All',exact:true}).click();
  await editor.getByRole('option',{name:/React/}).click();
  await expect(editor.getByRole('button',{name:'Remove React',exact:true})).toBeVisible();
  expect((await font(editor.getByText('Drag to reorder, or focus one and press ← →',{exact:true})))[0]).toBe('13px');
});

test.describe('profile editor touch reflow',()=>{
 test.use({hasTouch:true});
 test('all editor sections reflow with populated skills, social actions and contribution fields',async({page})=>{
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.saved={...f.saved,username:'builder_with_a_long_username',skills:['React'],socialLinks:[{id:'github',platform:'github',url:'https://github.com/builder',order:0},{id:'linkedin',platform:'linkedin',url:'https://www.linkedin.com/in/builder',order:1}]};f.refresh();});
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const sections:Array<[tab:string,heading:string]>=[['Details','Identity'],['Contributions','Contributions'],['Skills','Skills'],['Links','Your public links'],['Collaboration','Availability']];
  for(const width of [320,768,1024]) {
    await page.setViewportSize({width,height:900});
    for(const [tab,section] of sections) {
      await editor.getByRole('tab',{name:new RegExp(`^${tab}`)}).click();
      if(section==='Contributions'&&width===320) await editor.getByRole('button',{name:'Add external project',exact:true}).click();
      await expect(editor.getByRole('heading',{name:section,exact:true})).toBeVisible();
      expect(await editor.locator('[data-scroll-root="route"]').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      expect(await editor.getByRole('tabpanel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      // Beside the form the Changes card holds Save; narrower, the phone bar does once there is a change.
      if(width>=1024) await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeInViewport();
      if(width===320&&section==='Your public links') for(const action of await editor.getByRole('button',{name:/^(Edit|Remove|Move) (GitHub|LinkedIn)/}).all()) {
        const bounds=await action.boundingBox();expect(bounds!.width).toBeGreaterThanOrEqual(44);expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
});
