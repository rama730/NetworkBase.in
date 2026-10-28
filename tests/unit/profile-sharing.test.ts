import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShareResource, profileSharePath, portfolioSummary, shareSkillSummary, genericSharePreview, accessCopy, isShareCrawler } from '../../src/lib/sharing/presentation';
import { shareMetadata } from '../../src/lib/sharing/metadata';
import { normalizeLinkPreview } from '../../src/lib/links/preview-data';
import { queryKeys } from '../../src/lib/query-keys';

process.env.NEXT_PUBLIC_APP_URL = 'https://networkbase.in';
const origin = 'https://networkbase.in';

test('share URLs resolve trusted routes only, with normalized usernames and no private parameters', () => {
  assert.equal(profileSharePath(' Builder_One '), '/u/builder_one');
  for (const name of [null, 'x', 'bad-name', 'bad/name', 'x'.repeat(21), '11111111-1111-4111-8111-111111111111']) assert.equal(profileSharePath(name), null);
  assert.equal(parseShareResource('http://networkbase.in/u/BUILDER?auth=secret#portfolio', origin)?.url, origin+'/u/builder');
  assert.equal(parseShareResource(origin+'/projects/project-one?tab=settings', origin)?.url, origin+'/projects/project-one');
  assert.equal(parseShareResource(origin+'/org/acme-lab?tab=members', origin)?.url, origin+'/org/acme-lab');
  assert.equal(parseShareResource(origin+'/?workspace=secret', origin)?.url, origin+'/');
  for (const url of ['https://networkbase.in.example.com/u/builder', 'https://person@networkbase.in/u/builder', origin+':8443/u/builder', origin+'/u/%ZZ', origin+'/u/bad%2Fname', origin+'/my-profile', origin+'/messages/secret', origin+'/projects/new/settings', 'javascript:alert(1)']) assert.equal(parseShareResource(url,origin),null,url);
});

test('crawler optimization is explicit and never infers an actor or access level',()=>{
  assert.equal(isShareCrawler('facebookexternalhit/1.1'),true);assert.equal(isShareCrawler('LinkedInBot'),true);
  assert.equal(isShareCrawler('Mozilla/5.0'),false);assert.equal(isShareCrawler(null),false);
});

test('portfolio never guesses current work; one canonical title differs from a multiple-project total', () => {
  assert.equal(portfolioSummary(0),null);
  assert.equal(portfolioSummary(1,'Ponytail'),'Public portfolio · Ponytail');
  assert.equal(portfolioSummary(1,null),'Explore public portfolio');
  assert.equal(portfolioSummary(4,'Not a singled-out project'),'Public portfolio · 4 projects');
  assert.equal(portfolioSummary(null,null,true),'Explore public portfolio');
  assert.equal(portfolioSummary(null,null,false),null);
});

test('full skill names and actual overflow follow unique public labels', () => {
  for (const n of [0,1,2,4,5,7]) {
    const result=shareSkillSummary(Array.from({length:n},(_,i)=>'Skill '+i));
    assert.equal(result.skills.length,Math.min(n,4));assert.equal(result.skillOverflow,Math.max(n-4,0));
  }
  assert.equal(shareSkillSummary(['GitHub','github ','Cursor','Cursor','CodeRabbit']).skillOverflow,0);
  assert.equal(shareSkillSummary(['A','B','C','D'],8).skillOverflow,4);
});

test('restricted metadata stays generic, while public image metadata carries explicit dimensions and alt', () => {
  const resource=parseShareResource(origin+'/u/builder',origin)!;
  const preview=genericSharePreview(resource,'restricted');
  const metadata=shareMetadata(preview);
  assert.equal((metadata.openGraph as {type:string}).type,'profile');
  assert.equal(metadata.alternates?.canonical,resource.url);
  assert.deepEqual(metadata.robots,{index:false,follow:false,noarchive:true});
  assert.equal(preview.identity,undefined);assert.deepEqual(preview.skills,[]);
  assert.match(accessCopy({...preview,visibility:'private'}),/Sharing does not change access/);
  assert.match(accessCopy({...preview,state:'unknown'}),/could not load/);
});

test('in-app preview normalization strips identity from restricted payloads and rejects foreign canonical targets', () => {
  const url=origin+'/u/builder';const resource=parseShareResource(url,origin)!;
  const privateSnapshot={...genericSharePreview(resource,'restricted'),identity:{name:'Secret',username:'builder',avatarUrl:null,headline:'Private'},skills:['Secret skill'],portfolio:'Secret project',skillOverflow:3};
  const card=normalizeLinkPreview({url,firstParty:privateSnapshot},url)!;
  assert.equal(card.firstParty?.identity,undefined);assert.deepEqual(card.firstParty?.skills,[]);assert.equal(card.firstParty?.portfolio,null);
  assert.equal(normalizeLinkPreview({url,firstParty:{...privateSnapshot,url:'https://evil.test/u/builder'}},url)?.firstParty,undefined);
  assert.notDeepEqual(queryKeys.sharing.link(url,'owner','session-a'),queryKeys.sharing.link(url,'viewer','session-a'));
  assert.notDeepEqual(queryKeys.sharing.link(url,'owner','session-a'),queryKeys.sharing.link(url,'owner','session-b'));
});

test('project accessible metadata uses full approved fields and generic alt for an unsupported image script',()=>{
  const resource=parseShareResource(origin+'/projects/one')!;
  const preview={...genericSharePreview(resource,'ready'),title:'Project 一',description:'A useful public project',identity:{name:'Project 一',username:null,avatarUrl:null,headline:null}};
  const metadata=shareMetadata(preview);assert.equal((metadata.openGraph as any).images[0].alt,'NetworkBase project link');assert.equal(metadata.title,preview.title);
});

test('explicit project content destinations preserve only bounded known route state',async()=>{
  const {projectPreviewDestination}=await import('../../src/lib/sharing/presentation');
  const root=origin+'/projects/renamed',incoming=origin+'/projects/old?tab=tasks&drawerType=task&drawerId=NB-123&utm_source=secret&auth=token#overview';
  const opened=projectPreviewDestination(incoming,root);assert.equal(opened,root+'?tab=tasks&drawerType=task&drawerId=NB-123#overview');
  assert.equal(projectPreviewDestination(origin+'/projects/old?tab=files&path=../../secret&workspace=private',root),root+'?tab=files');
  const normalized=normalizeLinkPreview({url:incoming,firstParty:{...genericSharePreview(parseShareResource(root)!,'ready'),identity:{name:'Renamed',username:null,avatarUrl:null,headline:null}}},incoming)!;
  assert.equal(normalized.firstParty?.url,root);assert.equal(normalized.openUrl,opened);
});

test('project content file paths preserve Unicode names without accepting traversal',async()=>{
  const {projectPreviewDestination}=await import('../../src/lib/sharing/presentation');const root=origin+'/projects/one';
  const valid=projectPreviewDestination(root+'?tab=files&path='+encodeURIComponent('folder/设计 Notes.md'),root);assert.equal(new URL(valid).searchParams.get('path'),'folder/设计 Notes.md');
  for(const path of ['../secret','//elsewhere','%2e%2e/secret','C:\\secret'])assert.equal(new URL(projectPreviewDestination(root+'?tab=files&path='+encodeURIComponent(path),root)).searchParams.has('path'),false);
});

test('project payload normalization bounds people and roles and never turns unknown metrics into zero',()=>{
  const resource=parseShareResource(origin+'/projects/one')!,profile={name:'Project',username:null,avatarUrl:null,headline:null};
  const value={url:resource.url,firstParty:{...genericSharePreview(resource,'ready'),identity:profile,project:{team:[{id:'not-an-id',name:'Untrusted',email:'secret@example.com'}],teamOverflow:9,roles:[{id:'not-an-id',title:'Untrusted role'}],roleOverflow:9,views:-1,followers:0}}};
  const normalized=normalizeLinkPreview(value,resource.url)!;assert.equal(normalized.firstParty?.project?.team,null);assert.equal(normalized.firstParty?.project?.teamOverflow,null);assert.equal(normalized.firstParty?.project?.roles,null);assert.equal(normalized.firstParty?.project?.views,null);assert.equal(normalized.firstParty?.project?.followers,0);assert.equal(JSON.stringify(normalized).includes('secret@example.com'),false);
  const restricted=normalizeLinkPreview({...value,firstParty:{...value.firstParty,state:'restricted'}},resource.url)!;assert.equal(restricted.firstParty?.project,undefined);
});

test('optional team scripts do not suppress a renderable project image and drafts never promise public access',async()=>{
  const {socialImageCanRender,projectRolesFitImage}=await import('../../src/lib/sharing/presentation');const resource=parseShareResource(origin+'/projects/one')!;
  const preview={...genericSharePreview(resource,'ready'),title:'Project',description:'A public project',visibility:'public' as const,identity:{name:'Project',username:null,avatarUrl:null,headline:null},draft:true,project:{team:[{id:'11111111-1111-4111-8111-111111111111',name:'李雷',username:null,avatarUrl:null,role:'Team member'}],teamOverflow:0,roles:[{id:'11111111-1111-4111-8111-111111111111',title:'设计师'}],roleOverflow:0,views:0,followers:0}};
  assert.equal(socialImageCanRender(preview),true);assert.equal(projectRolesFitImage(preview),false);assert.match(accessCopy(preview),/Draft.*unpublished/);assert.doesNotMatch(accessCopy({...preview,draft:false,state:'restricted'}),/Anyone/);
});
