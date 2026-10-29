import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { normalizeDisplayAuthorization, previewDisplayDeadline, previewSessionBinding, PREVIEW_DISPLAY_LEASE_MS } from '../../src/lib/links/display-authorization';
import { maskLinkPreviewAccess, invalidateLinkPreviewAccess, type PreviewSnapshot } from '../../src/lib/links/client-preview-cache';
import { normalizeLinkPreview } from '../../src/lib/links/preview-data';
import { genericSharePreview, parseShareResource } from '../../src/lib/sharing/presentation';
import { queryKeys } from '../../src/lib/query-keys';

process.env.NEXT_PUBLIC_APP_URL='https://networkbase.in';
const viewerId='11111111-1111-4111-8111-111111111111',sessionBinding='a'.repeat(64),resourceKey='b'.repeat(64);
const issuedAt='2026-10-15T00:00:00.000Z',expiresAt='2026-10-15T00:01:00.000Z';
const authorization={viewerId,sessionBinding,resourceKey,issuedAt,expiresAt};

test('display proof is bounded, actor/session/resource qualified and charges network time',async()=>{
  assert.deepEqual(normalizeDisplayAuthorization(authorization),authorization);
  for(const value of [null,{}, {...authorization,sessionBinding:'raw-session'}, {...authorization,expiresAt:issuedAt}, {...authorization,expiresAt:'2026-10-15T00:01:01.000Z'}, {...authorization,issuedAt:'not a time'}])assert.equal(normalizeDisplayAuthorization(value),null);
  const input={viewerId,sessionBinding,resourceKey,startedAt:1000,serverTime:Date.parse(issuedAt)+10_000};
  assert.equal(previewDisplayDeadline(authorization,input),51_000);
  for(const fields of [{viewerId:null},{viewerId:'other'},{sessionBinding:'other'},{resourceKey:'other'},{serverTime:Date.parse(expiresAt)}])assert.equal(previewDisplayDeadline(authorization,{...input,...fields}),0);
  assert.equal(previewDisplayDeadline(authorization,{...input,serverTime:Date.parse(issuedAt)-1000}),1000+PREVIEW_DISPLAY_LEASE_MS);
  assert.equal(previewDisplayDeadline({...authorization,expiresAt:'2026-10-15T00:00:00.500Z'},{...input,serverTime:Date.parse(issuedAt)-500}),1500);
  assert.equal((await previewSessionBinding('session-a')).length,64);assert.notEqual(await previewSessionBinding('session-a'),await previewSessionBinding('session-b'));
});

test('normalization retains only approved binding and opaque resource fields',()=>{
  const url='https://networkbase.in/u/builder',resource=parseShareResource(url)!;
  const normalized=normalizeLinkPreview({url,title:'Builder',domain:'networkbase.in',firstParty:{...genericSharePreview(resource,'ready'),entityKey:resourceKey,visibility:'private',identity:{name:'Builder',username:'builder',headline:null,avatarUrl:null}},displayAuthorization:authorization},url)!;
  assert.equal(normalized.firstParty?.entityKey,resourceKey);assert.equal(normalized.firstParty?.visibility,'private');assert.deepEqual(normalized.displayAuthorization,authorization);
  assert.equal(normalizeLinkPreview({...normalized,displayAuthorization:{...authorization,sessionBinding:'token'}},url)?.displayAuthorization,null);
  const external='https://example.com/';assert.equal(normalizeLinkPreview({url:external,displayAuthorization:authorization},external)?.displayAuthorization,undefined);
});

test('known revocation masks only matching resource; global suspension masks all first-party proofs',async()=>{
  const client=new QueryClient(),url='https://networkbase.in/u/builder',resource=parseShareResource(url)!;
  const snapshot:PreviewSnapshot={preview:{url,domain:'networkbase.in',title:null,description:null,image:null,firstParty:{...genericSharePreview(resource,'ready'),entityKey:resourceKey}},authorization,deadline:100,wallDeadline:100};
  const one=queryKeys.sharing.link(url,viewerId,'a'),two=queryKeys.sharing.link('https://networkbase.in/workspaces/project-one',viewerId,'a');
  client.setQueryData(one,snapshot);client.setQueryData(two,{...snapshot,authorization:{...authorization,resourceKey:'c'.repeat(64)},preview:{...snapshot.preview!,firstParty:{...snapshot.preview!.firstParty!,entityKey:'c'.repeat(64)}}});
  maskLinkPreviewAccess(client,resourceKey);assert.equal(client.getQueryData<PreviewSnapshot>(one)?.authorization,null);assert.ok(client.getQueryData<PreviewSnapshot>(two)?.authorization);
  await invalidateLinkPreviewAccess(client,resourceKey);assert.equal(client.getQueryState(one)?.isInvalidated,true);assert.equal(client.getQueryState(two)?.isInvalidated,false);
  maskLinkPreviewAccess(client);assert.equal(client.getQueryData<PreviewSnapshot>(two)?.authorization,null);
  client.clear();
});


test('restricted and incomplete first-party payloads cannot retain legacy identity in fallback fields',()=>{
  const url='https://networkbase.in/workspaces/22222222-2222-4222-8222-222222222222',resource=parseShareResource(url)!;
  const value={url,title:'Secret title',description:'Secret summary',image:'https://example.com/private.png',firstParty:{...genericSharePreview(resource,'restricted'),url:'https://networkbase.in/workspaces/secret-readable-name',title:'Secret title',description:'Secret summary',imageAlt:'Secret creator'},displayAuthorization:authorization};
  const normalized=normalizeLinkPreview(value,url)!;assert.equal(normalized.firstParty?.url,url);assert.equal(JSON.stringify(normalized).includes('Secret'),false);assert.equal(normalized.image,null);assert.equal(normalized.displayAuthorization,null);
  const incomplete=normalizeLinkPreview({...value,firstParty:undefined},url)!;assert.equal(incomplete.title,null);assert.equal(incomplete.description,null);assert.equal(incomplete.image,null);
});
