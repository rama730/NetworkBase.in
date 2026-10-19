import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test } from '@playwright/test';

const origin='https://settings.test';
let script:string;
let css:string;
let sans:Buffer;
let mono:Buffer;
test.use({reducedMotion:'reduce'});
test.beforeAll(async()=>{
  const mocks:Record<string,string>={
    'next/navigation':`const router={replace:href=>window.settingsFixture.navigate(href,true)};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams(location.search);`,
    'next/link':`import React from 'react';export default ({href,children,...props})=>React.createElement('a',{href,...props},children);`,
  };
  for(const name of ['AccountSettings','AccountDeletionSettings','AppearanceSettings','IntegrationsSettings','NotificationsSettings','PrivacySettings','SecuritySettings','LegalAndDataRightsSection']){
    mocks['@/components/settings/'+name]=`import React,{useState} from 'react';function Leaf(){const [draft,setDraft]=useState('');return React.createElement('div',{style:{minHeight:400},className:'rounded-lg border border-border bg-card p-6'},React.createElement('label',null,'${name} draft',React.createElement('input',{value:draft,onChange:e=>setDraft(e.target.value)})));}export default Leaf;export const LegalAndDataRightsSection=Leaf;`;
  }
  const bundle=await build({entryPoints:[path.resolve('tests/browser/settings.fixture.tsx')],bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'isolated-settings',setup(b){b.onResolve({filter:/.*/},args=>args.path in mocks?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd(),loader:'js'}));}}]});
  script=bundle.outputFiles![0]!.text;
  const result=await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')});
  [sans,mono]=await Promise.all([readFile('src/app/fonts/InstrumentSans.ttf'),readFile('src/app/fonts/JetBrainsMono.ttf')]);
  css=`@font-face{font-family:'Instrument Sans';src:url('/sans.ttf');font-weight:400 700;}@font-face{font-family:'JetBrains Mono';src:url('/mono.ttf');font-weight:100 800;}:root{--font-instrument-sans:'Instrument Sans';--font-jetbrains-mono:'JetBrains Mono';}`+result.css;
});
test.beforeEach(async({page})=>{
  await page.route(origin+'/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/sans.ttf'||pathname==='/mono.ttf')return route.fulfill({contentType:'font/ttf',body:pathname==='/sans.ttf'?sans:mono});
    return route.fulfill({contentType:pathname==='/app.js'?'application/javascript':pathname==='/app.css'?'text/css':'text/html',body:pathname==='/app.js'?script:pathname==='/app.css'?css:'<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'});
  });
  await page.goto(origin+'/settings');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
});

test('settings navigation matches the application sidebar and stays in place while content scrolls',async({page})=>{
  const shell=page.getByRole('region',{name:'Settings',exact:true});
  const rail=shell.getByRole('complementary',{name:'Settings navigation'});
  const navigation=rail.getByRole('navigation',{name:'Settings sections'});
  const main=page.getByRole('navigation',{name:'Application navigation'});
  const reference=main.getByRole('link',{name:'Settings',exact:true});
  const bounds=await rail.boundingBox();
  expect(bounds!.width).toBe((await main.boundingBox())!.width);
  expect(bounds!.y).toBe(56);expect(bounds!.y+bounds!.height).toBe(1000);
  const title=rail.getByRole('heading',{name:'Settings',exact:true});
  expect(await title.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.textTransform];})).toEqual(['11px','500','uppercase']);
  expect(await page.getByRole('heading',{level:1}).count()).toBe(1);
  const divider=await title.locator('..').locator('[aria-hidden="true"]').boundingBox();
  expect(divider!.y).toBeGreaterThan((await title.boundingBox())!.y);
  const referenceBounds=await reference.boundingBox();
  for(const link of await navigation.getByRole('link').all()){
    const rect=await link.boundingBox();expect(rect!.height).toBeCloseTo(referenceBounds!.height,0);expect(rect!.width).toBeCloseTo(referenceBounds!.width,0);
    expect(await link.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.padding,s.borderRadius];})).toEqual(await reference.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.padding,s.borderRadius];}));
  }
  await navigation.getByRole('link',{name:'Appearance',exact:true}).click();
  await expect(page).toHaveURL(/tab=appearance/);
  await expect(navigation.getByRole('link',{name:'Appearance',exact:true})).toHaveAttribute('aria-current','page');
  expect((await rail.boundingBox())!.y).toBe(bounds!.y);
  const content=await shell.locator('[data-scroll-root="route"]').boundingBox();expect(content!.x).toBeGreaterThanOrEqual(bounds!.x+bounds!.width);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight===innerHeight)).toBe(true);
});

test('settings links and external URL changes scroll to the requested section without discarding mounted fields',async({page})=>{
  const nav=page.getByRole('navigation',{name:'Settings sections'});
  const draft=page.getByLabel('AccountSettings draft',{exact:true});
  await draft.fill('Unsaved local field');
  await nav.getByRole('link',{name:'Privacy',exact:true}).click();
  await expect(nav.getByRole('link',{name:'Privacy',exact:true})).toHaveAttribute('aria-current','page');
  await nav.getByRole('link',{name:'Account',exact:true}).click();
  await expect(page).toHaveURL(origin+'/settings');await expect(draft).toHaveValue('Unsaved local field');
  await expect.poll(()=>page.locator('[data-scroll-root="route"]').evaluate(el=>el.scrollTop)).toBe(0);
  await page.evaluate(()=>{const f=(window as any).settingsFixture;f.navigate('/settings?tab=security');});
  await expect(nav.getByRole('link',{name:'Security',exact:true})).toHaveAttribute('aria-current','page');
  await page.evaluate(()=>history.back());
  await expect(nav.getByRole('link',{name:'Account',exact:true})).toHaveAttribute('aria-current','page');
  await expect(draft).toHaveValue('Unsaved local field');
  await page.goto(origin+'/settings?tab=integrations');
  await expect(nav.getByRole('link',{name:'Integrations',exact:true})).toHaveAttribute('aria-current','page');
  await page.reload();await expect(nav.getByRole('link',{name:'Integrations',exact:true})).toHaveAttribute('aria-current','page');
  await page.goto(origin+'/settings?tab=invalid');await expect(nav.getByRole('link',{name:'Account',exact:true})).toHaveAttribute('aria-current','page');
});

test('manual scrolling updates navigation and nested data-rights anchors remain reachable',async({page})=>{
  const account=await page.locator('#settings-account').boundingBox();
  const security=await page.locator('#settings-security').boundingBox();
  await page.locator('[data-scroll-root="route"]').hover();
  await page.mouse.wheel(0,security!.y-account!.y);
  const nav=page.getByRole('navigation',{name:'Settings sections'});
  await expect(nav.getByRole('link',{name:'Security',exact:true})).toHaveAttribute('aria-current','page');
  await page.goto(origin+'/settings?tab=privacy-policies#settings-delete-account');
  await expect(page.getByLabel('AccountDeletionSettings draft',{exact:true})).toBeInViewport();
  await expect(nav.getByRole('link',{name:'Privacy and policies',exact:true})).toHaveAttribute('aria-current','page');
});

test.describe('touch layouts',()=>{
  test.use({hasTouch:true});
  test('all seven sections stay reachable on narrow and short viewports',async({page})=>{
    for(const size of [{width:320,height:740},{width:320,height:400},{width:768,height:600}]){
      await page.setViewportSize(size);
      const nav=page.getByRole('navigation',{name:'Settings sections'});
      await expect(nav.getByRole('link')).toHaveCount(7);
      for(const link of await nav.getByRole('link').all())expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await nav.getByRole('link',{name:'Privacy and policies',exact:true}).click();
      await expect(nav.getByRole('link',{name:'Privacy and policies',exact:true})).toHaveAttribute('aria-current','page');
      const content=page.locator('[data-scroll-root="route"]');
      expect((await content.boundingBox())!.height).toBeGreaterThan(100);
      expect(await content.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await nav.getByRole('link',{name:'Account',exact:true}).click();await expect(nav.getByRole('link',{name:'Account',exact:true})).toHaveAttribute('aria-current','page');
    }
  });
});
