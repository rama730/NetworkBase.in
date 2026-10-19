import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { genericSharePreview, parseShareResource } from '../../src/lib/sharing/presentation';

process.env.NEXT_PUBLIC_APP_URL='https://networkbase.in';
const viewerId='11111111-1111-4111-8111-111111111111',sessionId='server-only-session-a';
const binding=createHash('sha256').update(sessionId).digest('hex');
const origin='https://networkbase.in',url=origin+'/u/builder',resource=parseShareResource(url)!;

test('real route issues bounded actor/session/resource proofs and rejects scope changes before reading identity',async()=>{
  const fixture={viewerId,sessionId,expiresAt:Math.floor(Date.now()/1000)+3600,reads:0,
    preview:{...genericSharePreview(resource,'ready'),entityKey:'b'.repeat(64),title:'Builder One',identity:{name:'Builder One',username:'builder',avatarUrl:null,headline:null}}};
  (globalThis as any).__previewRouteFixture=fixture;
  const mocks:Record<string,string>={
    '@/app/api/v1/_envelope':`export const jsonSuccess=(data,_meta,options)=>new Response(JSON.stringify({success:true,data}),options);export const jsonError=(error,status)=>new Response(JSON.stringify({success:false,error}),{status});`,
    '@/app/api/v1/_shared':`export const enforceRouteLimit=async()=>null;export const requireAuthenticatedUser=async()=>({user:{id:'${viewerId}'},response:null});`,
    '@/lib/server/viewer-context':`export const getViewerAuthContext=async()=>{const f=globalThis.__previewRouteFixture;return {userId:f.viewerId,snapshot:{sessionId:f.sessionId,expiresAt:f.expiresAt}};};`,
    '@/lib/sharing/read':`export const readSharePreview=async()=>{const f=globalThis.__previewRouteFixture;f.reads++;return f.preview;};`,
    '@/lib/redis':`export const getRedisClient=()=>null;`,
    '@/lib/logger':`export const logger={warn:()=>{},error:()=>{}};`,
  };
  const result=await build({entryPoints:['src/app/api/v1/link-preview/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'route-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
  const loaded={exports:{} as {GET:(request:unknown)=>Promise<Response>}};
  new Function('require','module','exports',result.outputFiles![0]!.text)(createRequire(import.meta.url),loaded,loaded.exports);
  const request=(actor=viewerId,session=binding)=>({url:origin+'/api/v1/link-preview?url='+encodeURIComponent(url),nextUrl:new URL(origin+'/api/v1/link-preview?url='+encodeURIComponent(url)),headers:new Headers({'x-preview-viewer':actor,'x-preview-session':session})});
  try{
    const response=await loaded.exports.GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie, Authorization');
    const body=await response.json(),proof=body.data.displayAuthorization;assert.equal(proof.viewerId,viewerId);assert.equal(proof.sessionBinding,binding);assert.equal(proof.resourceKey,'b'.repeat(64));assert.equal(Date.parse(proof.expiresAt)-Date.parse(proof.issuedAt),60_000);assert.equal(JSON.stringify(body).includes(sessionId),false);
    fixture.reads=0;assert.equal((await loaded.exports.GET(request('33333333-3333-4333-8333-333333333333'))).status,401);assert.equal((await loaded.exports.GET(request(viewerId,'c'.repeat(64)))).status,401);assert.equal(fixture.reads,0);
    fixture.expiresAt=Math.floor(Date.now()/1000)+5;const short=await (await loaded.exports.GET(request())).json();assert.ok(Date.parse(short.data.displayAuthorization.expiresAt)-Date.parse(short.data.displayAuthorization.issuedAt)<=5000);
    fixture.preview=genericSharePreview(resource,'restricted') as typeof fixture.preview;const restricted=await(await loaded.exports.GET(request())).json();assert.equal(restricted.data.displayAuthorization,null);assert.equal(restricted.data.firstParty.identity,undefined);assert.equal(JSON.stringify(restricted).includes('Builder One'),false);
    fixture.sessionId='changed-session';assert.equal((await loaded.exports.GET(request())).status,401);
  }finally{delete (globalThis as any).__previewRouteFixture;}
});
