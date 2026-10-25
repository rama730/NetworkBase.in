import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parseProfileEditSection,profileEditHref,profileEditReturnHref} from '../../src/lib/profile/edit-route';

test('profile edit destinations allow only existing sections and a fixed profile return route',()=>{
    for(const section of ['general','experience','skills','social','opportunity'] as const){assert.equal(parseProfileEditSection(section),section);assert.equal(new URL(profileEditHref(section),'https://networkbase.in').searchParams.get('section'),section);}
    for(const value of [null,undefined,'https://example.com','../settings','', ['skills','social']])assert.equal(parseProfileEditSection(value),'general');
    assert.equal(profileEditReturnHref('portfolio'),'/my-profile?tab=portfolio');assert.equal(profileEditReturnHref('https://example.com'),'/my-profile');assert.equal(profileEditHref('experience','portfolio'),'/my-profile/edit?section=experience&returnTab=portfolio');
});

test('the actual editor route authenticates before reads and only renders the current owner',async()=>{
    const id='11111111-1111-4111-8111-111111111111';const fixture={user:null as null|{id:string},completed:true,reads:0,options:null as unknown,data:{isOwner:true,profile:{id,username:'builder'},collaborationSummary:{contributions:[]}}};
    (globalThis as any).__profileEditRoute=fixture;
    const mocks:Record<string,string>={
        'next/navigation':`export const redirect=p=>{throw new Error('redirect:'+p)};export const notFound=()=>{throw new Error('not-found')};`,
        '@/lib/server/viewer-context':`export const getViewerAuthContext=async()=>({user:globalThis.__profileEditRoute.user});`,
        '@/lib/onboarding/completion':`export const hasCompletedOnboarding=async()=>globalThis.__profileEditRoute.completed;`,
        '@/lib/data/profile':`export const getProfileDetails=async(_id,options)=>{const f=globalThis.__profileEditRoute;f.reads++;f.options=options;return f.data;};`,
        '@/components/profile/edit/EditProfileEditor':`export function EditProfileEditor(){return null;}`,
    };
    const result=await build({entryPoints:['src/app/(site)/(main)/my-profile/edit/page.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'profile-owner-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
    const compiled={exports:{} as {default:(p:unknown)=>Promise<any>;metadata:any}};new Function('require','module','exports',result.outputFiles![0]!.text)(createRequire(import.meta.url),compiled,compiled.exports);
    const props={searchParams:Promise.resolve({section:'opportunity',returnTab:'portfolio'})};
    try{
        await assert.rejects(compiled.exports.default(props),/redirect:\/login/);assert.equal(fixture.reads,0);
        fixture.user={id};const element=await compiled.exports.default(props);assert.equal(element.props.initialSection,'opportunity');assert.equal(element.props.profile.id,id);assert.deepEqual(fixture.options,{viewerUser:{id},recordViewEvent:false});assert.equal(compiled.exports.metadata.robots.index,false);
        fixture.data.isOwner=false;await assert.rejects(compiled.exports.default(props),/not-found/);fixture.data.isOwner=true;fixture.data.profile={id:'other-user',username:'other'};await assert.rejects(compiled.exports.default(props),/not-found/);
        fixture.data.profile={id,username:'builder'};fixture.completed=false;await assert.rejects(compiled.exports.default(props),/redirect:\/onboarding/);
    }finally{delete(globalThis as any).__profileEditRoute;}
});
