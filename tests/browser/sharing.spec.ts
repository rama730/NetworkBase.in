import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {test,expect} from '@playwright/test';
let script:string,css:string;
const origin='https://networkbase.in';
test.beforeAll(async()=>{
  const mocks:Record<string,string>={
    'next/dynamic':`export default ()=>()=>null;`,
    '@/components/messages/MessageEditBox':`export const EditBox=()=>null;`,
    '@/components/messages/useConversation':`export const useUpdatePages=()=>patch=>window.sharingFixture.patchMessages(patch);`,
    '@/components/messages/failed-sends':`export const discardSend=()=>{};export const editFailedSend=()=>{};export const failedSend=()=>null;export const retrySend=()=>{};`,
    '@/components/messages/cards/MessageCard':`export const MessageCard=()=>null;`,
    '@/components/messages/parts/message-attachments':`export const MessageAttachmentsV2=()=>null;`,
    '@/components/presence/PersonHoverCard':`export const PersonHoverCard=({children})=>children;`,
    '@/app/actions/chat/messages':`export const hideLinkPreview=input=>window.sharingFixture.hidePreview(input);export const listReactors=async()=>({success:true,reactors:{}});export const react=async()=>({success:true});export const createTaskFromMessage=async()=>({success:false});export const deleteMessage=async()=>({success:false});export const editMessage=async()=>({success:false});export const markUnread=async()=>({success:false});export const pinMessage=async()=>({success:false});export const reportMessage=async()=>({success:false});`,
    '@/components/presence/usePresence':`export const usePersonPresence=()=>({availability:'offline',label:'Offline',status:null});export const useProjectPresence=()=>({availability:'offline',label:'Offline'});`,
    '@/components/presence/PersonPresence':`export const ProjectPresenceBadge=()=>null;export const PersonPresenceBadge=()=>null;export const PresenceAvatar=()=>null;`,
    'next/link':`import React from 'react';export default ({children,href,prefetch,...props})=>React.createElement('a',{href,...props},children);`,
    'next/image':`import React from 'react';export default ({fill,priority,unoptimized,...props})=>React.createElement('img',props);`,
    '@/hooks/use-auth':`export const useAuth=()=>({user:window.sharingFixture.user,session:window.sharingFixture.session,refreshProfile:async()=>{}});`,
    '@/hooks/useAuth':`export const useAuth=()=>({user:window.sharingFixture.user,session:window.sharingFixture.session,refreshProfile:async()=>{}});`,
    '@/app/actions/sharing-destinations':`export const listShareDestinations=input=>window.sharingFixture.list(input);export const listShareProjects=input=>window.sharingFixture.listProjects(input);export const getShareDestination=input=>window.sharingFixture.destination(input);`,
    '@/components/messages/ChatShellProvider':`export const useChatShell=()=>({data:{channels:window.sharingFixture.channels},refresh:()=>{},loadError:null});`,
    '@/app/actions/sharing':`export const sendSharedLink=input=>window.sharingFixture.send(input);export const saveShareUsername=async()=>({success:true,updatedAt:'2026-10-14T01:00:00.000Z'});`,
    '@/app/actions/profile':`export const updateProfileAction=async input=>({success:true,updatedAt:'2026-10-14T01:00:00.000Z'});`,
  };
  script=(await build({entryPoints:[path.resolve('tests/browser/sharing.fixture.tsx')],bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"','process.env.APP_URL':'undefined','process.env.NEXT_PUBLIC_APP_URL':'"https://networkbase.in"'},plugins:[{name:'isolated-sharing',setup(b){
    b.onResolve({filter:/.*/},args=>args.path in mocks?{path:args.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd(),loader:'js'}));
  }}]})).outputFiles![0]!.text;
  css=(await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')})).css;
});
test.beforeEach(async({page})=>{
  await page.clock.install();
  page.on('pageerror',error=>console.error('Sharing fixture:',error.stack));
  await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v1/share-preview'){
      const data=await page.evaluate(input=>{const f=(window as any).sharingFixture;return {publicPreview:f.preview(input),viewerPreview:f.preview(input,true),viewerId:f.serverSignedIn?(f.user?.id??null):null};},url.searchParams.get('url')!);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
    }
    if(url.pathname==='/api/v1/link-preview'){
      const data=await page.evaluate(async input=>{const f=(window as any).sharingFixture;f.requests++;if(f.previewDelay)await new Promise(resolve=>setTimeout(resolve,f.previewDelay));
        if(!input.startsWith('https://networkbase.in/'))return {url:input,domain:'example.com',title:'External resource',description:'External summary',image:null};
        const issuedAt=Date.now()-(f.expiredLease?120_000:0),binding=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.session.id));
        return {url:input,domain:'networkbase.in',title:'Builder One',description:'Product Engineer',image:null,firstParty:f.preview(input,true),displayAuthorization:{viewerId:f.wrongActor?'33333333-3333-4333-8333-333333333333':f.user.id,sessionBinding:f.wrongSession?'a'.repeat(64):Array.from(new Uint8Array(binding),byte=>byte.toString(16).padStart(2,'0')).join(''),resourceKey:'b'.repeat(64),issuedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(issuedAt+60_000).toISOString()}};
      },url.searchParams.get('url')!);
      if(await page.evaluate(()=>(window as any).sharingFixture.previewError))return route.fulfill({status:503,body:'Unavailable'});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
    }
    return route.fulfill({contentType:url.pathname==='/app.js'?'application/javascript':url.pathname==='/app.css'?'text/css':'text/html',body:url.pathname==='/app.js'?script:url.pathname==='/app.css'?css:'<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'});
  });await page.goto(origin);await page.getByRole('button',{name:'Share profile',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Builder One',{exact:true})).toBeVisible();
});

test('canonical URL, full skills and native/copy feedback obey the approved flow',async({page})=>{
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('textbox',{name:'Profile link'})).toHaveValue(origin+'/u/builder');
  await expect(dialog.getByText('Public portfolio · Ponytail')).toBeVisible();await expect(dialog.getByText('+3',{exact:true})).toBeVisible();
  await page.evaluate(()=>{(window as any).sharingFixture.copyDenied=true;});await dialog.getByRole('button',{name:'Copy link'}).click();
  await expect(dialog.getByRole('status')).toHaveText('Select and copy the link manually.');
  expect(await dialog.getByRole('textbox',{name:'Profile link'}).evaluate((input:HTMLInputElement)=>input.selectionEnd!-input.selectionStart!)).toBe((origin+'/u/builder').length);
  await page.evaluate(()=>{(window as any).sharingFixture.nativeResult='cancel';});await dialog.getByRole('button',{name:'Share to…'}).click();
  await expect(dialog.getByRole('status')).not.toContainText('Could not');
  await page.evaluate(()=>{(window as any).sharingFixture.nativeResult='failure';});await dialog.getByRole('button',{name:'Share to…'}).click();await expect(dialog.getByRole('status')).toContainText('Copy the link instead');
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Share profile',exact:true})).toBeFocused();
});

test('private owner sees a qualified internal card but native payload remains anonymous',async({page})=>{
  await page.evaluate(async()=>{const f=(window as any).sharingFixture;f.privacy='private';await f.invalidate();});
  await expect(page.getByText('Profile on NetworkBase',{exact:true})).toBeVisible();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'On NetworkBase',exact:true}).click();await expect(dialog.getByText('Builder One',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Share to…'}).click();expect(await page.evaluate(()=>(window as any).sharingFixture.payload.title)).toBe('Profile on NetworkBase');
});

test('failed/uncertain sends retain drafts and receipt retries use one intent',async({page})=>{
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();await dialog.getByRole('button',{name:/Ponytail/}).click();await dialog.getByRole('radio').check();
  await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Please meet this builder.');
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.sendResult='uncertain';f.delay=150;});
  await dialog.getByRole('button',{name:'Send',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Check the earlier receipt');
  await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('Please meet this builder.');
  await dialog.getByRole('button',{name:'Check earlier send',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Already sent.');
  const ids=await page.evaluate(()=>(window as any).sharingFixture.attempts.map((input:any)=>input.clientId));expect(ids.length).toBe(2);expect(ids[0]).toBe(ids[1]);
});

test('session expiry retains a same-account draft; a different account clears it',async({page})=>{
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();await dialog.getByRole('button',{name:/Ponytail/}).click();await dialog.getByRole('radio').check();await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Retained note');
  await page.evaluate(()=>{(window as any).sharingFixture.sendResult='auth';});await dialog.getByRole('button',{name:'Send',exact:true}).click();await expect(dialog.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('Retained note');
  await page.evaluate(async()=>{const f=(window as any).sharingFixture;f.user={id:'33333333-3333-4333-8333-333333333333'};f.session={id:'session-b'};f.refresh();});
  await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('');await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
});

test('mobile long labels fit and private cached in-app cards disappear immediately offline',async({page,context})=>{
  await page.setViewportSize({width:320,height:740});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.keyboard.press('Escape');await page.evaluate(()=>{const f=(window as any).sharingFixture;f.mode='message';f.refresh();});await expect(page.getByRole('link',{name:/Open profile/})).toBeVisible();
  await expect(page.getByText('Builder One',{exact:true})).toBeVisible();await context.setOffline(true);await expect(page.getByText('Builder One',{exact:true})).not.toBeVisible();await expect(page.getByText(/Offline. Reconnect/)).toBeVisible();
});

test('username setup returns to sharing without changing a private profile',async({page})=>{
  await page.keyboard.press('Escape');await page.evaluate(()=>{const f=(window as any).sharingFixture;f.path=null;f.privacy='private';f.refresh();});
  await page.getByRole('button',{name:'Share profile',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Set username',exact:true}).click();await dialog.getByRole('textbox',{name:'Username',exact:true}).fill('new_builder');
  await dialog.getByRole('button',{name:'Save username',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Profile link'})).toHaveValue(origin+'/u/new_builder');
  await expect(dialog.getByText('Profile on NetworkBase',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).sharingFixture.privacy)).toBe('private');
});

test('send picker starts with projects, isolates channels and retains notes across destination types',async({page})=>{
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();
  await expect(dialog.getByRole('button',{name:/Ponytail/})).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:/Ponytail/}).click();
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await dialog.getByRole('radio').check();
  await expect(dialog.getByText('Send to Ponytail / #general',{exact:true})).toBeVisible();
  await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Keep this note while browsing');
  await dialog.getByRole('button',{name:'All projects',exact:true}).click();
  await dialog.getByRole('button',{name:/DeepScope AI/}).click();
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await expect(dialog.getByRole('radio')).not.toBeChecked();
  await dialog.getByRole('radio').check();
  await expect(dialog.getByText('Send to DeepScope AI / #general',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Direct messages',exact:true}).click();
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await expect(dialog.getByRole('radio')).not.toBeChecked();
  await expect(dialog.getByText('Priya Sharma',{exact:true})).toBeVisible();
  await dialog.getByRole('radio').check();
  await expect(dialog.getByText('Send to Priya Sharma',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('Keep this note while browsing');
  await dialog.getByRole('button',{name:'More',exact:true}).click();
  await dialog.getByRole('button',{name:/Group conversations/}).click();
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await expect(dialog.getByText('Design review',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Priya Sharma',{exact:true})).not.toBeVisible();
});

test('picker withholds stale destinations offline and after access loss, preserving the note',async({page,context})=>{
  await page.setViewportSize({width:320,height:740});
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();
  await dialog.getByRole('button',{name:/Ponytail/}).click();await dialog.getByRole('radio').check();
  await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Saved draft');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await context.setOffline(true);await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  await expect(dialog.getByText('Send to Ponytail / #general',{exact:true})).not.toBeVisible();
  await context.setOffline(false);await expect(dialog.getByRole('radio')).toHaveCount(1);
  await page.evaluate(async()=>{const f=(window as any).sharingFixture;f.channels=f.channels.filter((c:any)=>c.id!=='22222222-2222-4222-8222-222222222222');await f.invalidate();});
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('Saved draft');
});


async function openMessages(page:any,options:Record<string,unknown>={}){
  await page.keyboard.press('Escape');await page.evaluate((options:Record<string,unknown>)=>{const f=(window as any).sharingFixture;Object.assign(f,options,{mode:'message'});f.refresh();},options);
  await expect(page.locator('.msg-first-party-preview a')).toHaveCount(Number(options.rowCount??1));
  await expect(page.locator('.msg-first-party-preview').first()).toContainText(options.kind==='project'?'Ponytail':'Builder One');
}

test('both first-party card types use half the lane, wrap on narrow panes and reuse author actions',async({page})=>{
  await openMessages(page);const row=page.getByRole('article'),preview=page.locator('.msg-first-party-preview');
  for(const kind of ['profile','project']){
    if(kind==='project')await page.evaluate(()=>{const f=(window as any).sharingFixture;f.path='/projects/ponytail';f.messagePages=[];f.refresh();});
    await expect(preview).toContainText(kind==='profile'?'Builder One':'Ponytail');
    for(const width of [960,720,715.5,360]){
      await page.evaluate(width=>{const f=(window as any).sharingFixture;f.laneWidth=width;f.refresh();},width);
      const geometry=await preview.evaluate(card=>{const lane=card.closest('.msg-link-preview-boundary')!;return {card:card.getBoundingClientRect().width,lane:lane.getBoundingClientRect().width};});
      expect(geometry.card).toBeCloseTo(Math.min(480,geometry.lane<640?geometry.lane:geometry.lane*.5),0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    }
    const remove=row.getByRole('button',{name:'Remove link preview for everyone'});await remove.focus();expect(await remove.evaluate(e=>getComputedStyle(e).opacity)).toBe('1');expect(await remove.evaluate(e=>e.closest('a'))).toBeNull();
    expect((await remove.boundingBox())!.width).toBe(44);await remove.click();await expect(preview).toHaveCount(0);await expect(row).toContainText('Sharing this for you to explore.');await expect(row.getByRole('link').first()).toHaveAttribute('href',kind==='profile'?'/u/builder':'/projects/ponytail');
    await row.hover();await row.getByRole('button',{name:'More actions'}).click();await page.getByRole('menuitem',{name:'Restore link preview'}).click();await expect(preview).toContainText(kind==='profile'?'Builder One':'Ponytail');
    await page.evaluate(()=>{(window as any).sharingFixture.removeFails=true;});await remove.click();await expect(preview).toContainText(kind==='profile'?'Builder One':'Ponytail');await expect(page.getByText(/can't.*edit|no longer.*change|not.*edit|permission|cannot.*edit/i).last()).toBeVisible();await page.evaluate(()=>{(window as any).sharingFixture.removeFails=false;});
  }
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.user={id:'33333333-3333-4333-8333-333333333333'};f.session={id:'session-b'};f.refresh();});await expect(row.getByRole('button',{name:'Remove link preview for everyone'})).toHaveCount(0);await row.hover();await row.getByRole('button',{name:'More actions'}).click();await expect(page.getByRole('menuitem',{name:/link preview/})).toHaveCount(0);
});

test('two minutes of shared preview checks retain the card DOM and avoid duplicate URL requests',async({page})=>{
  await openMessages(page,{rowCount:2});await page.waitForTimeout(100);
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.originalCard=document.querySelector('.msg-first-party-preview a');f.originalAuthor=document.querySelector('[data-message-row]');f.originalText=f.originalCard.textContent;f.mutations=[];f.commits=[];
    new MutationObserver(records=>f.mutations.push(...records.map(r=>r.type))).observe(f.originalCard,{childList:true,subtree:true,characterData:true});});
  expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(1);
  for(let i=0;i<4;i++){await page.clock.fastForward(30_000);await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(i+2);await expect(page.locator('.msg-first-party-preview a')).toHaveCount(2);await expect(page.locator('.msg-first-party-preview a').first()).toContainText('Builder One');await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.previewFetching())).toBe(0);}
  const evidence=await page.evaluate(()=>{const f=(window as any).sharingFixture;return {sameCard:f.originalCard===document.querySelector('.msg-first-party-preview a'),sameRow:f.originalAuthor===document.querySelector('[data-message-row]'),sameText:f.originalText===f.originalCard.textContent,mutations:f.mutations,requests:f.requests,commits:f.commits.length};});
  expect(evidence.sameCard).toBe(true);expect(evidence.sameRow).toBe(true);expect(evidence.sameText).toBe(true);expect(evidence.mutations).toEqual([]);expect(evidence.requests).toBe(5);test.info().annotations.push({type:'preview-performance',description:JSON.stringify(evidence)});await test.info().attach('preview-performance',{body:JSON.stringify(evidence),contentType:'application/json'});console.info('Preview performance evidence:',JSON.stringify(evidence));
});

test('offscreen and hidden previews suspend checks and reverify on return',async({page})=>{
  await openMessages(page,{rowCount:2});await page.evaluate(()=>{const f=(window as any).sharingFixture;f.messageGap=3000;f.refresh();});
  await page.waitForTimeout(50);const requests=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.clock.fastForward(120_000);await expect(page.locator('.msg-first-party-preview a').first()).not.toContainText('Builder One');expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(requests);
  await page.locator('[data-message-row]').first().scrollIntoViewIfNeeded();await expect(page.locator('.msg-first-party-preview a').first()).toContainText('Builder One');await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(requests+1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('.msg-first-party-preview a').first()).not.toContainText('Builder One');const hiddenRequests=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.clock.fastForward(120_000);expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(hiddenRequests);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('.msg-first-party-preview a').first()).toContainText('Builder One');expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(hiddenRequests+1);
});

test('invalid actor, session or expired proof cannot reveal cached private details',async({page})=>{
  await openMessages(page);for(const flag of ['wrongActor','wrongSession','expiredLease','previewError']){
    await page.evaluate(async(flag:string)=>{const f=(window as any).sharingFixture;f[flag]=true;await f.invalidate();},flag);await expect(page.locator('.msg-first-party-preview')).not.toContainText('Builder One');await expect(page.getByRole('button',{name:'Retry preview'})).toBeVisible();
    await page.evaluate(async(flag:string)=>{const f=(window as any).sharingFixture;f[flag]=false;await f.invalidate();},flag);await expect(page.locator('.msg-first-party-preview')).toContainText('Builder One');
  }
  await page.evaluate(async()=>{const f=(window as any).sharingFixture;f.previewDelay=200;f.previewDenied=true;await f.invalidateAccess();});await expect(page.locator('.msg-first-party-preview')).not.toContainText('Builder One');await expect(page.locator('.msg-first-party-preview')).toContainText('Profile on NetworkBase');
});

test('one offscreen occurrence does not disable a visible shared query',async({page})=>{
  await openMessages(page,{rowCount:2});await page.evaluate(()=>{document.querySelectorAll('[data-message-row]')[1]!.setAttribute('style','margin-top:2500px');});await page.locator('[data-message-row]').first().scrollIntoViewIfNeeded();await expect(page.locator('.msg-first-party-preview a').first()).toContainText('Builder One');const before=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.clock.fastForward(30_000);await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(before+1);
});


test.describe('touch preview controls',()=>{
  test.use({hasTouch:true});
  test('remove remains visible and restore uses the existing touch action sheet',async({page})=>{
    await page.setViewportSize({width:360,height:740});await openMessages(page);const remove=page.getByRole('button',{name:'Remove link preview for everyone'});expect(await remove.evaluate(e=>getComputedStyle(e).opacity)).toBe('1');expect((await remove.boundingBox())!.width).toBe(44);await remove.tap();await expect(page.locator('.msg-first-party-preview')).toHaveCount(0);
    const row=page.locator('[data-message-row]');await row.dispatchEvent('touchstart');await page.clock.runFor(600);await row.dispatchEvent('touchend');await page.getByRole('button',{name:'Restore link preview',exact:true}).tap();await expect(page.locator('.msg-first-party-preview')).toContainText('Builder One');
  });
});


test('genuine content updates remain visible and an in-flight old account response cannot restore identity',async({page})=>{
  await openMessages(page);await page.evaluate(async()=>{const f=(window as any).sharingFixture;f.displayName='Updated Builder';await f.invalidate();});await expect(page.locator('.msg-first-party-preview')).toContainText('Updated Builder');
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.previewDelay=350;void f.invalidate();});await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(3);
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.user={id:'33333333-3333-4333-8333-333333333333'};f.session={id:'session-b'};f.previewDenied=true;f.refresh();});await expect(page.locator('.msg-first-party-preview')).not.toContainText('Updated Builder');await page.waitForTimeout(500);await expect(page.locator('.msg-first-party-preview')).not.toContainText('Updated Builder');await expect(page.locator('.msg-first-party-preview')).toContainText('Profile on NetworkBase');
});

test('failed renewal masks the preview without a retry storm and back-forward restore revalidates',async({page})=>{
  await openMessages(page);await page.evaluate(()=>{(window as any).sharingFixture.previewError=true;});await page.clock.fastForward(30_000);await expect(page.locator('.msg-first-party-preview')).not.toContainText('Builder One');const count=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.clock.fastForward(15_000);expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(count);
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.previewError=false;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await expect(page.locator('.msg-first-party-preview')).toContainText('Builder One');expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(count+1);
});


test('a same-session remount retains a still-authorized snapshot without a new fetch',async({page})=>{
  await openMessages(page);const count=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.evaluate(()=>{const f=(window as any).sharingFixture;f.mode='dialog';f.open=false;f.refresh();});await expect(page.locator('.msg-first-party-preview')).toHaveCount(0);
  await page.evaluate(()=>{const f=(window as any).sharingFixture;f.mode='message';f.refresh();});await expect(page.locator('.msg-first-party-preview')).toContainText('Builder One');expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(count);
});


test('refocus rechecks shared access once and never retains a newly restricted name',async({page})=>{
  await openMessages(page,{rowCount:2});const before=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.evaluate(()=>{const f=(window as any).sharingFixture;f.previewDenied=true;window.dispatchEvent(new Event('focus'));});await expect(page.locator('.msg-first-party-preview').first()).not.toContainText('Builder One');expect(await page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(before+1);
});


test('preview loading and renewal need no optional AbortSignal static combinators',async({page})=>{
  await page.evaluate(()=>{Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:undefined});});await openMessages(page);const count=await page.evaluate(()=>(window as any).sharingFixture.requests);await page.clock.fastForward(30_000);await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.requests)).toBe(count+1);await expect.poll(()=>page.evaluate(()=>(window as any).sharingFixture.previewFetching())).toBe(0);await expect(page.locator('.msg-first-party-preview')).toContainText('Builder One');
});


test('ordinary external previews retain their existing loading and card behavior',async({page})=>{
  await openMessages(page);await page.evaluate(()=>{const f=(window as any).sharingFixture;f.previewDelay=400;f.messagePages=[f.messagePages[0].map((m:any)=>({...m,body:'https://example.com/\nAn external link'}))];f.refresh();});
  await expect(page.locator('a.msg-rich-content[aria-busy=true]')).toBeVisible();await expect(page.getByText('External resource',{exact:true})).toBeVisible();await expect(page.locator('.msg-first-party-preview')).toHaveCount(0);
});


test('project share preview presents the approved team, statistics and open role caps without a missing-image box',async({page})=>{
  await openMessages(page,{path:'/projects/ponytail',kind:'project'});const card=page.locator('.msg-first-party-preview');await expect(card.getByLabel('Project team')).toBeVisible();await expect(card.getByRole('img',{name:'Builder One · Lead / Product Engineer'})).toBeVisible();await expect(card.getByRole('img',{name:'2 more permitted team members'})).toBeVisible();await expect(card.getByLabel('12345 views')).toHaveCount(0);await expect(card.getByLabel('12,345 views',{exact:true})).toBeVisible();await expect(card.getByLabel('0 followers',{exact:true})).toBeVisible();await expect(card.getByLabel('Open role titles')).toContainText('Researcher');await expect(card.getByLabel('2 more open roles')).toBeVisible();await expect(card.getByText('By Builder One')).toHaveCount(0);expect(await card.locator('a button,a [tabindex]').count()).toBe(0);
  const owner=card.getByRole('img',{name:'Builder One · Lead / Product Engineer'});await owner.focus();await expect(page.getByRole('tooltip')).toContainText('Builder One');await expect(page.getByRole('tooltip')).toContainText('Lead / Product Engineer');await page.keyboard.press('Escape');
  const member=card.getByRole('img',{name:'Collaborator 1 · Designer · Member'});await member.focus();await expect(page.getByRole('tooltip').filter({hasText:'Collaborator 1'})).toContainText('Designer · Member');await page.keyboard.press('Escape');
  for(const target of [owner,card.getByRole('img',{name:'2 more permitted team members'}),card.getByLabel('Project skills').locator('.nb-tag').first(),card.getByLabel('Open role titles').locator('.nb-tag').first(),card.getByLabel('2 more open roles')]) expect(await target.evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeLessThanOrEqual(5);
  expect(await owner.locator('[data-slot=user-avatar]').evaluate(el=>getComputedStyle(el).borderTopLeftRadius)).toBe('5px');
  const title=card.getByText('Ponytail',{exact:true});const delta=await title.evaluate(e=>e.getBoundingClientRect().left-e.closest('.msg-first-party-preview')!.getBoundingClientRect().left);expect(delta).toBeLessThan(18);await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});


test('an uncertain original receipt survives Back, edited notes and a different destination',async({page})=>{
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();await dialog.getByRole('button',{name:/Ponytail/}).click();await dialog.getByRole('radio').check();await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Original note');await page.evaluate(()=>{(window as any).sharingFixture.sendResult='uncertain';});await dialog.getByRole('button',{name:'Send',exact:true}).click();await expect(dialog.getByRole('button',{name:'Check earlier send'})).toBeVisible();
  await dialog.getByRole('button',{name:'Back to sharing'}).click();await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Edited draft');await dialog.getByRole('button',{name:'Direct messages',exact:true}).click();await dialog.getByRole('radio').check();await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Check earlier send'}).click();await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('Edited draft');await expect(dialog.getByRole('status')).toContainText('No additional message');
  const attempts=await page.evaluate(()=>(window as any).sharingFixture.attempts);expect(attempts).toHaveLength(2);expect(attempts[1].clientId).toBe(attempts[0].clientId);expect(attempts[1].channelId).toBe(attempts[0].channelId);expect(attempts[1].note).toBe('Original note');expect(attempts[1].checkOnly).toBe(true);
});

test('a missing receipt only retries the original intent and leaves an edited draft separate',async({page})=>{
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Send in NetworkBase'}).click();await dialog.getByRole('button',{name:/Ponytail/}).click();await dialog.getByRole('radio').check();await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Original');await page.evaluate(()=>{(window as any).sharingFixture.sendResult='unconfirmed-missing';});await dialog.getByRole('button',{name:'Send',exact:true}).click();await dialog.getByRole('textbox',{name:'Note (optional)'}).fill('Edited');await dialog.getByRole('button',{name:'Check earlier send'}).click();await expect(dialog.getByRole('status')).toContainText('No earlier receipt');await expect(dialog.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await page.evaluate(()=>{(window as any).sharingFixture.sendResult='success';});await dialog.getByRole('button',{name:'Retry earlier send'}).click();await expect(dialog.getByRole('textbox',{name:'Note (optional)'})).toHaveValue('Edited');const attempts=await page.evaluate(()=>(window as any).sharingFixture.attempts);expect(new Set(attempts.map((a:any)=>a.clientId)).size).toBe(1);expect(attempts.at(-1).note).toBe('Original');
});


test('general project sharing strips route context while explicit message cards retain validated content destinations',async({page})=>{
  await page.keyboard.press('Escape');await page.evaluate(()=>{const f=(window as any).sharingFixture;f.kind='project';f.path='/projects/ponytail?tab=tasks&drawerType=task&drawerId=NB-123&workspace=secret';f.refresh();});await page.getByRole('button',{name:'Share profile',exact:true}).click();await expect(page.getByRole('dialog').getByRole('textbox',{name:'Link',exact:true})).toHaveValue(origin+'/projects/ponytail');
  await page.keyboard.press('Escape');await page.evaluate(()=>{const f=(window as any).sharingFixture;f.mode='message';f.refresh();});await expect(page.locator('.msg-first-party-preview')).toContainText('Ponytail');await expect(page.locator('.msg-first-party-preview a').first()).toHaveAttribute('href',origin+'/projects/ponytail?tab=tasks&drawerType=task&drawerId=NB-123');
});
