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
    '@/hooks/useUsernameAvailability': `export const useUsernameAvailability=()=>({status:'valid',message:''});`,
    '@/lib/skills/client': `const catalog={version:'fixture',categories:[{key:'engineering',name:'Engineering',iconKey:'code'}],lookup:{},defaults:[]};export const useSkillCatalog=()=>catalog;export const resolveClientSkill=name=>({name,canonicalKey:name.toLowerCase(),categoryKey:'engineering',kind:'framework',iconSource:'monogram',status:'active'});export const defaultClientSkills=()=>['React','TypeScript'].map(resolveClientSkill);`,
    '@/components/skills': `export const SkillIcon=()=>null;`,
    '@/components/presence/presence-ui-store': `export const usePresenceUi=()=>open=>{window.profileFixture.pickerOpen=open;};`,
    '@/components/presence/usePresence': `export const useNow=()=>Date.now();export const usePersonPresence=()=>{const p=window.profileFixture.presence||({availability:'now',availabilityText:'Active now',status:null});return {...p,label:[p.status?.emoji,p.statusText,p.availabilityText].filter(Boolean).join(' · ')};};export const useWorkspacePresence=()=>({availability:'offline',label:'Offline'});`,
    '@/components/messages/message-user': `export const messageUserInWindow=id=>{window.profileFixture.messaged.push(id);return true;};`,
    './sections/WorkspacesGridCard': `export const WorkspacesGridCard=()=>null;`,
    './sections/WorkspaceContributionsCard': `export const WorkspaceContributionsCard=()=>null;`,
    './ProfileRightRail': `export const ProfileRightRail=()=>null;`,
    './ProfileInviteModal': `export default ()=>null;`,
    '@/components/workspaces/ApplyRoleModal': `export default ()=>null;`,
    '@/app/actions/profile-contributions': `export const saveProfileContributionsAction=async()=>({success:true});`,
    '@/app/actions/profile': `export const updateProfileAction=p=>window.profileFixture.save(p); export const createProfileImageUploadUrlAction=async()=>({});export const finalizeProfileImageUploadAction=async()=>({});`,
    '@/lib/services/avatar-worker-client': `export const compressAvatarOffMainThread=async f=>f;`,
    '@/lib/upload/supabase-signed-upload-client': `export const uploadToSupabaseSignedUrl=async()=>{};`,
    '@/lib/profile/browser-profile': `export const loadProfileContributionsPage=async()=>({contributions:[],total:0,hasMore:false});export const loadProfileContributionWindow=async()=>({contributions:[],total:0,hasMore:false});`,
    '@/app/actions/connections': `export const getProfileConnectionCountAction=async()=>({success:true,connectionsCount:window.profileFixture.count});
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
  await expect(dialog.getByRole('tab', { name: 'Collaboration preferences' })).toHaveAttribute('data-state', 'active');
  await dialog.getByRole('switch', { name: 'Open to collaboration', exact: true }).click();
  await dialog.getByRole('button', { name: 'Design', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Skills' }).click();
  await dialog.getByRole('tab', { name: 'Collaboration preferences' }).click();
  await expect(dialog.getByRole('switch', { name: 'Open to collaboration', exact: true })).toBeChecked();
  expect(await page.evaluate(() => (window as any).profileFixture.calls.length)).toBe(0);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('switch', { name: 'Open to collaboration', exact: true })).toBeChecked();
  await expect(page.getByText('Design', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit role preferences', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Collaboration preferences' })).toHaveAttribute('data-state', 'active');
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
  await expect(page.getByRole('heading', { name: 'Collaboration preferences', exact: true })).toBeVisible();
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
  await expect(dialog.getByRole('tab', {name:'Collaboration preferences'})).toHaveAttribute('data-state','active');
  await dialog.getByPlaceholder('e.g. Next.js Developer, Rust Dev').fill('Game developer');
  await dialog.getByRole('button', {name:'Add role',exact:true}).click();
  await dialog.getByRole('button', {name:'Save changes',exact:true}).click();
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
  await expect(card.getByRole('heading')).toHaveText('Collaboration preferences');
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
      return {labelX:label.x,labelCenter:label.y+label.height/2,valueX:value.x,valueCenter:value.y+value.height/2,valueRight:value.right,textRights};
    }));
    for(const pos of positions) {
      expect(pos.labelX).toBeCloseTo(positions[0]!.labelX,0);
      expect(pos.valueX).toBeCloseTo(positions[0]!.valueX,0);
      expect(pos.labelCenter).toBeCloseTo(pos.valueCenter,0);
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

test('profile tabs do not create a scroll container and retain keyboard navigation', async ({page}) => {
  const tabs=page.getByRole('tablist',{name:'Profile sections'});
  const overview=tabs.getByRole('tab',{name:'Overview',exact:true});
  const portfolio=tabs.getByRole('tab',{name:'Portfolio',exact:true});
  for(const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:900});
    const overflow=await tabs.evaluate(el=>{
      const style=getComputedStyle(el);
      el.scrollTop=100;
      el.scrollLeft=100;
      return {x:style.overflowX,y:style.overflowY,top:el.scrollTop,left:el.scrollLeft,fits:el.scrollWidth<=el.clientWidth};
    });
    expect(overflow).toEqual({x:'visible',y:'visible',top:0,left:0,fits:true});
    await portfolio.click();
    await expect(portfolio).toHaveAttribute('aria-selected','true');
    await portfolio.press('ArrowLeft');
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute('aria-selected','true');
  }
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
  const action=card.getByRole('button',{name:'Invite to workspace',exact:true});
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
  await editor.getByRole('tab',{name:'Collaboration preferences'}).click();await expect(page).toHaveURL(/section=opportunity/);await page.reload();await expect(editor.getByRole('tab',{name:'Collaboration preferences'})).toHaveAttribute('data-state','active');
  await editor.getByRole('button',{name:'Design',exact:true}).click();await editor.getByRole('tab',{name:'Skills'}).click();await editor.getByRole('tab',{name:'Collaboration preferences'}).click();await expect(editor.getByRole('button',{name:'Design',exact:true})).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>(window as any).profileFixture.calls.length)).toBe(0);
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
  await editor.getByRole('button',{name:'Reset',exact:true}).click();expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})).toBe(false);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page).toHaveURL(/\/my-profile$/);
});

test('Discard and leave on a plain link follows that link',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();
  await page.getByRole('link',{name:'Network',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).getByRole('button',{name:'Discard and leave',exact:true}).click();await expect(page).toHaveURL(/\/network$/);
});

test('editor sections form a left navigation rail beside the form and use vertical keyboard navigation',async({page})=>{
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const navigation=editor.getByRole('complementary',{name:'Profile edit sections'});
  const tabs=editor.getByRole('tab');
  const panel=editor.getByRole('tabpanel');
  await expect(editor.locator('header')).toHaveCount(0);
  await expect(editor.getByRole('tablist')).toHaveAttribute('aria-orientation','vertical');
  const navBounds=await navigation.boundingBox();
  const panelBounds=await panel.boundingBox();
  const mainNavigation=page.getByRole('navigation',{name:'Fixture application navigation'});
  expect(navBounds!.width).toBe((await mainNavigation.boundingBox())!.width);
  expect(navBounds!.y).toBe(56);
  expect(navBounds!.y+navBounds!.height).toBe(1000);
  const title=navigation.getByRole('heading',{name:'Edit profile',exact:true});
  await expect(title).toBeVisible();
  const titleBounds=await title.boundingBox();
  const dividerBounds=await title.locator('..').locator('[aria-hidden="true"]').boundingBox();
  const firstTabBounds=await tabs.first().boundingBox();
  expect(dividerBounds!.y).toBeGreaterThanOrEqual(titleBounds!.y+titleBounds!.height);
  expect(dividerBounds!.height).toBe(1);
  expect(firstTabBounds!.y).toBeGreaterThanOrEqual(dividerBounds!.y+dividerBounds!.height+12);
  const mainButton=page.getByRole('link',{name:'Network',exact:true});
  const mainButtonBounds=await mainButton.boundingBox();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(navBounds!.x+navBounds!.width);
  let previousBottom=0;
  for(const tab of await tabs.all()) {
    const bounds=await tab.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(navBounds!.x);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(navBounds!.x+navBounds!.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(previousBottom);
    expect(bounds!.height).toBeCloseTo(mainButtonBounds!.height,0);
    expect(bounds!.width).toBeCloseTo(mainButtonBounds!.width,0);
    expect(await tab.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.padding,s.borderRadius];})).toEqual(await mainButton.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.padding,s.borderRadius];}));
    previousBottom=bounds!.y+bounds!.height;
  }
  const actions=editor.locator('footer');
  const actionBounds=await actions.boundingBox();
  expect(actionBounds!.height).toBeLessThanOrEqual(64);
  expect(actionBounds!.x).toBeGreaterThanOrEqual(navBounds!.x+navBounds!.width);
  expect(actionBounds!.x+actionBounds!.width).toBe((await editor.boundingBox())!.x+(await editor.boundingBox())!.width);
  expect(actionBounds!.y+actionBounds!.height).toBe(1000);
  const scrollBounds=await editor.locator('[data-scroll-root="route"]').boundingBox();
  expect(actionBounds!.x).toBe(scrollBounds!.x);
  expect(actionBounds!.width).toBe(scrollBounds!.width);
  expect(await actions.evaluate(el=>{const s=getComputedStyle(el);return [s.borderLeftWidth,s.borderTopLeftRadius,s.borderTopRightRadius];})).toEqual(['0px','0px','0px']);
  expect(scrollBounds!.y+scrollBounds!.height).toBeLessThanOrEqual(actionBounds!.y);
  await editor.getByRole('tab',{name:'Profile details'}).focus();
  await page.keyboard.press('ArrowDown');
  await expect(editor.getByRole('tab',{name:'Contributions'})).toBeFocused();
  await expect(page).toHaveURL(/section=experience/);
  const initialNavTop=navBounds!.y;
  await editor.getByRole('tab',{name:'Profile details'}).click();
  await editor.locator('[data-scroll-root="route"]').evaluate(el=>el.scrollTo({top:el.scrollHeight}));
  expect((await navigation.boundingBox())!.y).toBe(initialNavTop);
  await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  for(const width of [1440,1024,768]) {
    await page.setViewportSize({width,height:1000});
    await expect(editor.getByRole('tablist')).toHaveAttribute('aria-orientation','vertical');
    expect(await editor.locator('[data-scroll-root="route"]').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
  }
  await page.setViewportSize({width:320,height:740});
  await expect(editor.getByRole('tablist')).toHaveAttribute('aria-orientation','horizontal');
});

test('editor keeps save controls visible on mobile and does not create horizontal scrolling',async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const nav=editor.getByRole('tablist');expect(await nav.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(false);await editor.getByRole('tab',{name:'Skills'}).focus();await page.keyboard.press('ArrowRight');await expect(editor.getByRole('tab',{name:'Links and profiles'})).toBeFocused();
  await editor.getByRole('tab',{name:'Collaboration preferences'}).click();
  await editor.getByRole('button',{name:'Design',exact:true}).click();
  const assertReachable=async()=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    for(const button of await editor.locator('footer button').all()) await expect(button).toBeInViewport();
    const content=await editor.locator('[data-scroll-root="route"]').boundingBox();
    const actions=await editor.locator('footer').boundingBox();
    expect(content!.height).toBeGreaterThan(100);
    expect(content!.y+content!.height).toBeLessThanOrEqual(actions!.y);
  };
  await assertReachable();
  await page.evaluate(()=>(window as any).profileFixture.fail=true);
  await editor.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('Save failed');
  await assertReachable();
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Keep editing',exact:true})).toBeVisible();
  await assertReachable();
});

test('pending editor saves block repeated writes and complete by returning to the profile',async({page})=>{
  await page.getByRole('button',{name:'Edit role preferences',exact:true}).click();const editor=page.getByRole('region',{name:'Edit profile',exact:true});await editor.getByRole('button',{name:'Design',exact:true}).click();await page.evaluate(()=>{(window as any).profileFixture.delay=500;});await editor.getByRole('button',{name:'Save changes',exact:true}).click();await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();await expect(editor.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await expect(editor).not.toBeVisible();expect(await page.evaluate(()=>(window as any).profileFixture.calls.length)).toBe(1);
});

test('deep links reject invalid section names and editing cannot continue under a different account',async({page})=>{
  await page.goto(origin+'/my-profile/edit?section=not-a-section');const editor=page.getByRole('region',{name:'Edit profile',exact:true});await expect(editor.getByRole('tab',{name:'Profile details'})).toHaveAttribute('data-state','active');
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.actorId='22222222-2222-4222-8222-222222222222';f.refresh();});await expect(page.getByRole('alert')).toContainText('different account');await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);
});

test('portfolio edit links return to portfolio without changing the selected profile view',async({page})=>{
  await page.getByRole('tab',{name:'Portfolio',exact:true}).click();await page.getByRole('button',{name:'Edit profile',exact:true}).click();await expect(page).toHaveURL(/returnTab=portfolio/);await page.getByRole('region',{name:'Edit profile',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();await expect(page).toHaveURL(origin+'/my-profile?tab=portfolio');await expect(page.getByRole('tab',{name:'Portfolio',exact:true})).toHaveAttribute('aria-selected','true');
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
  expect((await font(editor.getByRole('heading',{name:'Edit profile',exact:true}))).slice(0,3)).toEqual(['11px','13.2px','500']);
  expect((await font(editor.getByRole('heading',{name:'Profile details',exact:true}))).slice(0,3)).toEqual(['20px','25.6px','600']);
  expect((await font(editor.getByRole('heading',{name:'Basic information',exact:true}))).slice(0,3)).toEqual(['17px','21.76px','600']);
  expect((await font(editor.locator('label[for="profile-full-name"]'))).slice(0,3)).toEqual(['13px','15.6px','500']);
  expect((await font(editor.getByLabel('Full name',{exact:false}))).slice(0,2)).toEqual(['15px','22.5px']);
  expect(await font(editor.locator('#profile-full-name-count'))).toEqual(['12px','16.2px','400','"JetBrains Mono", monospace']);
  await expect(editor.locator('#profile-username-url')).toHaveText('profile.test/u/builder');
  for(const dark of [false,true]) for(const [density,inset,height] of [['compact',20,30],['default',24,34],['comfortable',28,42]] as const) {
    await page.evaluate(({dark,density})=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.dataset.density=density;},{dark,density});
    await editor.getByRole('tab',{name:'Profile details'}).click();
    expect(await editor.locator('[data-scroll-root="route"]').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBe(inset);
    expect((await editor.getByLabel('Full name',{exact:false}).boundingBox())!.height).toBe(height);
    await editor.getByRole('tab',{name:'Collaboration preferences'}).click();
    expect((await editor.getByLabel('Experience level',{exact:true}).boundingBox())!.height).toBe(height);
    const selected=editor.getByRole('button',{name:'Engineering',exact:true});
    expect(await selected.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('3px');
    expect(await selected.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await editor.evaluate(el=>getComputedStyle(el).color));
  }
  await editor.getByRole('tab',{name:'Skills'}).click();
  await editor.getByRole('button',{name:'All',exact:true}).click();
  await editor.getByRole('option',{name:/React/}).click();
  await expect(editor.getByRole('button',{name:'Remove React',exact:true})).toBeVisible();
  expect((await font(editor.getByText('Search skills or add your own.',{exact:true})))[0]).toBe('13px');
});

test.describe('profile editor touch reflow',()=>{
 test.use({hasTouch:true});
 test('all editor sections reflow with populated skills, social actions and contribution fields',async({page})=>{
  await page.evaluate(()=>{const f=(window as any).profileFixture;f.saved={...f.saved,username:'builder_with_a_long_username',skills:['React'],socialLinks:[{id:'github',platform:'github',url:'https://github.com/builder',order:0},{id:'linkedin',platform:'linkedin',url:'https://www.linkedin.com/in/builder',order:1}]};f.refresh();});
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  const editor=page.getByRole('region',{name:'Edit profile',exact:true});
  const sections=['Profile details','Contributions','Skills','Links and profiles','Collaboration preferences'];
  for(const width of [320,768,1024]) {
    await page.setViewportSize({width,height:900});
    for(const section of sections) {
      await editor.getByRole('tab',{name:section,exact:true}).click();
      if(section==='Contributions'&&width===320) await editor.getByRole('button',{name:'Add external project',exact:true}).click();
      await expect(editor.getByRole('heading',{name:section,exact:true})).toBeVisible();
      expect(await editor.locator('[data-scroll-root="route"]').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      expect(await editor.getByRole('tabpanel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      // Contributions saves each entry itself, so that tab has no shared footer.
      if(section!=='Contributions') await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeInViewport();
      if(width===320&&section==='Links and profiles') for(const action of await editor.getByRole('button',{name:/^(Edit|Remove|Move) (GitHub|LinkedIn)/}).all()) {
        const bounds=await action.boundingBox();expect(bounds!.width).toBeGreaterThanOrEqual(44);expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
});
