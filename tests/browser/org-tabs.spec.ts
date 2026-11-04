import { serverActionsPlugin } from './server-actions-plugin';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';

// Org tabs at phone width (report §31.2 G13) and keyboard reach (G16), against the real components and stylesheet.
const origin = 'https://org-tabs.test';
let script: string, css: string;
const ok = 'async()=>({success:true})';
const people = `Array.from({length:12},(_,i)=>({userId:'u'+i,name:i===3?'Alexandria Ramana Chandrasekhar':'Student '+i,role:i===0?'owner':i===1?'admin':'member',title:i===2?'Section B':null,
    projects:[{id:'c1',title:'Team Falcon — Distributed Systems Capstone',unit:'Frontend'}],work:{done:i%4,total:5,missing:i%3},lastActiveAt:new Date(Date.now()-i*36e5).toISOString(),
    joinedAt:new Date().toISOString(),behind:i%3===2,inactive:false,avatarUrl:null,username:'s'+i}))`;

test.beforeAll(async () => {
    const mocks: Record<string, string> = {
        'next/link': `import React from 'react';export default ({href,children,prefetch,...p})=>React.createElement('a',{href,...p},children);`,
        'next/navigation': `export const usePathname=()=>'/org/cse-3a',useRouter=()=>({refresh(){},push(){},replace(){}});`,
        '@/app/actions/org-members': `export const readOrgInvitePanelAction=async()=>({success:true});export const previewOrgInviteEmailAction=async()=>({success:true});export const readOrgMembersAction=async()=>({success:true,viewerRole:'owner',joinCode:'K7M2QX',rows:${people},
            requests:[{id:'r1',userId:'x',name:'Priya Natarajan',note:'Roll 21, section B',createdAt:new Date().toISOString()}],invites:[],
            children:[{id:'c1',title:'Team Falcon',units:[{id:'un',title:'Frontend'}]}],outside:[{userId:'o1',name:'Client Person',username:null,projects:[{id:'c1',title:'Team Falcon'}]}],summary:{members:12,admins:2,guests:0,behind:4,notInProject:0,inactive:0},teamChanges:[]});
            export const readMemberAwayAction=async()=>({success:true,away:[]}),markAwayAction=async()=>({success:true,excused:0}),endAwayAction=async()=>({success:true});export const readMemberWorkAction=async()=>({success:true,work:[]}),readMemberActivityAction=async()=>({success:true,activity:[{at:new Date().toISOString(),what:'status changed',task:'Lab 2',project:'Team Falcon'}]});
            export const remindMembersAction=async()=>({success:true,reminded:2});
            export const addMembersToChildAction=${ok},approveJoinRequestsAction=${ok},cancelOrgInviteAction=${ok},changeMemberRoleAction=${ok},declineJoinRequestAction=${ok},inviteByEmailAction=async()=>({success:true,invalid:[]}),removeMembersAction=${ok},resendOrgInviteAction=${ok},setMemberTitleAction=${ok},moveMemberToWorkspaceAction=${ok},dismissTeamChangeAction=${ok},removeOutsidePersonAction=${ok},inviteFormerMemberAction=${ok},readProgressExportAction=async()=>({success:true,rows:[]});
            export const readRoleChangePreviewAction=async()=>({success:true,people:1,openRemoved:2,submittedKept:3,gainsOpen:0,leads:[]});
            export const readRemovalPreviewAction=async()=>({success:true,people:1,workspaces:1,seats:1,openRemoved:2,submittedKept:3,tasks:1,skipped:[]});
            export const readFormerMembersAction=async()=>({success:true,rows:[{userId:'f1',name:'Asha Rao',how:'removed',at:new Date().toISOString(),by:'Ms. Rao',note:'Repeated no-shows',blocked:true,done:3,total:4}]});`,
        '@/app/actions/moderation-org': `export const unblockFromOrgAction=${ok};`,
        '@/hooks/use-auth': `export const useAuth=()=>({user:{id:'u1'}});`,
        '@/app/actions/organizations': `export const joinOrganizationAction=${ok},updateJoinRequestNoteAction=${ok};export const updateOrgSettingsAction=async()=>({success:true});export const unarchiveChildAction=async()=>({success:true});export const readLeadCandidatesAction=async()=>({success:true});export const detachChildAction=async()=>({success:true});export const cancelMoveInAction=async()=>({success:true});export const cancelDetachRequestAction=async()=>({success:true});export const assignChildLeadAction=async()=>({success:true});export const approveMoveInAction=async()=>({success:true});export const regenerateJoinCodeAction=async()=>({success:true,joinCode:'Q2W3E4'}),archiveChildAction=${ok},cancelJoinRequestAction=${ok},joinPublicOrgAction=${ok},childTitleTakenAction=async()=>false;
            export const listOrgRosterAction=async(orgId,q,admins)=>[['u1','Ravi Kumar','member','In Compiler Lab',['React']],['u2','Asha Nair','member',null,['Testing']],['u3','Ms. Rao','owner',null,[]]]
              .filter((p)=>!admins||p[2]!=='member').map(([userId,name,role,projectHint,skills])=>({userId,name,username:null,avatarUrl:null,title:role==='owner'?'Teacher':null,role,projectHint,skills}));
            export const listOutsidePeopleAction=async()=>[{userId:'x1',name:'Client Person',username:'client',avatarUrl:null,title:'Mentor',role:'outside',projectHint:null}];`,
        '@/app/actions/org-profile': `export const revokeOrgVerificationAction=${ok},verifyOrgContributionsAction=${ok};`,
        '@/app/actions/workspace/updates': `const ok=async()=>({success:true});export const toggleWorkspaceUpdatePinAction=ok,createWorkspaceUpdateMediaUploadUrlAction=ok,finalizeWorkspaceUpdateMediaUploadAction=ok,saveWorkspaceUpdateDraftAction=ok;export const readWorkspaceUpdateDraftAction=async()=>({success:true,draft:null}),readWorkspaceUpdateContextOptionsAction=async()=>({success:true,tasks:[],sprints:[],files:[]});`,
        '@/app/actions/org-dashboard': `export const dismissWelcomeAction=async()=>({success:true}),hidePinnedForMeAction=async()=>({success:true});export const readChildOrgLineAction=async()=>null,readOrgDashboardAction=async()=>({success:false,error:'unused'});
            export const readOrgWorkspacesAction=async()=>({success:true,isAdmin:true,requests:[],summary:{total:3,attention:1,quiet:1,notInProject:2},rows:['Team Falcon — Distributed Systems Capstone','Team Osprey','Team Kestrel'].map((title,i)=>({
            id:'c'+i,title,slug:'p'+i,visibility:['org','private','public'][i],status:'active',lead:{id:'l',name:'Alexandria Ramana Chandrasekhar'},members:6,units:2,open:4,overdue:i,inReview:1,
            groupCopy:i?null:{title:'Milestone 2 report',state:'submitted'},lastActivityAt:new Date(Date.now()-i*864e5).toISOString(),reasons:i===1?['2 overdue','quiet 7 days']:[],mine:i===0,
            stage:['Build','Idea','Build'][i],sprint:i===0?{name:'Parser week',inOrgSprint:true}:null,newInOrg:i===2,openSeats:i,needsLead:false,archivedBy:null,github:null}))});
            export const remindLeadsAction=async()=>({success:true,reminded:2});`,
        '@/app/actions/org-files': `export const readOrgSubmissionsAction=async()=>({success:true});export const readChildFinalFilesAction=async()=>({success:true});export const browseOrgFilesAction=async()=>({success:true,org:{id:'org',title:'CSE-3A Software Engineering',slug:'cse-3a'},nodes:[
            {id:'f1',name:'Week 1 — Requirements',type:'folder',path:'/w1',currentVersion:1,size:null,access:null},
            {id:'f2',name:'Distributed-systems-capstone-rubric-final-v3.pdf',type:'file',path:'/r.pdf',currentVersion:3,size:1,access:'public'}]});
            export const listOrgCopiesAction=async()=>({success:true,orgTitle:'CSE-3A',copies:[{nodeId:'n',name:'rubric.pdf',sourceNodeId:'f2',copiedVersion:1,sourceVersion:3}]});
            export const listOrgFoldersAction=async()=>({success:true,folders:[{id:'d1',path:'/Week 1 — Requirements and stakeholder interviews',access:'admins',template:true},{id:'d2',path:'/Rubrics',access:null,template:false}]});
            export const recordOrgCopyAction=${ok},setFolderAccessAction=async()=>({success:true,preview:null}),setFolderTemplateAction=${ok};
            export const readOrgStorageAction=async()=>({usedBytes:4.3*1024**3,limitBytes:5*1024**3,warn:true}),readOrgSprintMaterialsAction=async()=>({success:true,groups:[]});
            export const readGroupDeliverablesAction=async()=>({success:true,rows:[{nodeId:'g1',name:'parser.zip',project:'Team Falcon',projectSlug:'falcon',projectId:'c1',assignment:'Milestone 2 report',review:'pending'}]});`,
        '@/components/organizations/OrgDocParts': `export const uploadWorkspaceFile=async()=>({id:'n'});`,
        '@/app/actions/child-units': `export const readChildUnitsAction=async()=>({success:true,units:[
            {id:'un1',title:'Frontend developers',count:4,filled:2,leadUserId:'u1',members:[{userId:'u1',name:'Ravi Kumar'},{userId:'u2',name:'Alexandria Ramana Chandrasekhar'}]},
            {id:'un2',title:'Developer testing unit',count:2,filled:2,leadUserId:null,members:[{userId:'u4',name:'Meena'},{userId:'u5',name:'John'}]}],unplaced:[{userId:'u6',name:'Kiran'}]});
            export const updateUnitAction=${ok},moveMemberToUnitAction=${ok},createUnitAction=${ok},removeUnitAction=${ok},readTeamMovePreviewAction=async()=>({success:true,openTasks:0}),readWorkspaceUnitsAction=async()=>[];`,
        '@/components/messages/message-user': `export const messageUserInWindow=()=>false;`,
        '@/app/actions/org-lifecycle': `export const restoreOrgAction=${ok};`,
        '@/hooks/useFileVersions': `export const saveFileRevision=async()=>({success:true});`,
        '@/components/reports/ReportDialog': `export const ReportDialog=()=>null;export const useReportDialog=()=>({open:()=>{},dialog:null});export const ReportMenuItem=()=>null;export const useOpenReportCase=()=>()=>{};`,
        '@/components/workspaces/dashboard/WorkspaceSocialLinksCard': `export const WorkspaceLinkCluster=()=>null;`,
        '@/app/actions/presence': `const none=async()=>({success:true,data:{}});export const getPresence=none,getMyPresenceSettings=none,setMyStatus=none,clearMyStatus=none,resumeNotifications=none,setStatusVisibility=none,setShowActivity=none;`,
        '@/app/actions/workspace/doc': `export const listWorkspaceDocsAction=async()=>({success:true,docs:[]});`,
        '@/app/actions/assignments': `const counts={not_started:3,in_progress:2,submitted:4,returned:0,done:1,missing:2,excused:0,total:12};
            export const listAssignmentsAction=async()=>({success:true,isAdmin:true,timeZone:'Asia/Kolkata',rows:[
            {masterId:'a1',title:'Lab 3 — Consensus protocols and failure detectors',dueDate:new Date(Date.now()+864e5).toISOString(),status:'open',submissionType:'link',reviewRequired:true,teams:true,counts,mine:null},
            {masterId:'a2',title:'Reading quiz',dueDate:null,status:'draft',submissionType:'none',reviewRequired:false,teams:false,counts,mine:null}]});
            export const readAssignmentComposerOptionsAction=async()=>({success:true,children:[],sprints:[],teamAssignments:[],defaults:{reviewRequired:true,lateRule:'until'}}),readAssignmentRosterAction=async()=>({success:true,counts,rows:[
              {copyId:'t1',label:'Team A',members:[],people:[{id:'u1',name:'Ravi Kumar',lead:true},{id:'u2',name:'Alexandria Ramana Chandrasekhar',lead:false}],submittedBy:null,state:'in_progress',late:false,projectId:'org',dueDate:null,submission:null,excusedReason:null,submittedAt:null,version:null,remindedAt:new Date(Date.now()-3*3600e3).toISOString(),userId:null,avatarUrl:null,updatedAt:new Date(Date.now()-5*3600e3).toISOString()},
              {copyId:'t2',label:'Priya (individual)',members:[],state:'missing',late:false,projectId:'org',dueDate:null,submission:null,excusedReason:null,submittedAt:null,version:null,remindedAt:null,userId:'u4',avatarUrl:null,updatedAt:new Date(Date.now()-2*864e5).toISOString()},
              {copyId:'t3',label:'Kiran',members:[],state:'submitted',late:true,projectId:'org',dueDate:null,submission:{link:'https://example.com/k'},excusedReason:null,submittedAt:new Date(Date.now()-600e3).toISOString(),version:2,remindedAt:null,userId:'u5',avatarUrl:null,updatedAt:new Date(Date.now()-600e3).toISOString()}],withoutCopy:[{userId:'u9',name:'Late Joiner'}],closed:false});
            export const listWorkspaceGroupCopiesAction=async()=>({success:true,rows:[]});
            export const approveAllSubmittedAction=${ok},closeAssignmentAction=${ok},createAssignmentAction=${ok},deleteAssignmentAction=${ok},excuseCopyAction=${ok},extendCopyAction=${ok},publishAssignmentAction=${ok},reviewAssignmentCopyAction=${ok},submitAssignmentAction=${ok},giveCopyAction=${ok},reopenAssignmentAction=${ok},scheduleAssignmentAction=${ok},updateAssignmentAction=${ok},removeCopyAction=${ok},autoMakeGroupsAction=async()=>({success:true,groups:[]});
            export const extendCopiesAction=async()=>({success:true,extended:1}),returnCopiesAction=async()=>({success:true,returned:1,skipped:0}),readAssignmentExportAction=async()=>({success:true,rows:[['Person']]});
            export const readAssignmentForReuseAction=async()=>({success:true,form:{title:'Lab 3',description:'Read chapter 3',submissionType:'link',reviewRequired:true,lateRule:'always',lateAfterMinutes:15,steps:['Read'],target:{mode:'everyone'},materials:[],dueDate:null}});
            export const searchAssignmentMaterialsAction=async()=>({success:true,files:[{id:'k',name:'answers.pdf',adminsOnly:true}]}),readAssignmentMaterialsAction=async()=>({success:true,materials:[]});
            export const addAssignmentStepAction=${ok},excuseTeamMemberAction=${ok},moveTeamMemberAction=${ok},remindCopiesAction=async()=>({success:true,reminded:3}),readAssignmentTeamsAction=async()=>({success:true,teams:[]});
            const q={kind:'copy',projectId:'org',updatedAt:new Date().toISOString(),version:2,link:null,text:'Consensus answer',note:'Used Raft',files:[],versions:[],steps:[...Array(4)].map((_,i)=>({title:'Step '+i,done:true})).concat([{title:'Write up',done:false}]),comments:2,left:false,dueDate:null};
            export const readReviewQueueAction=async()=>({success:true,total:2,recentReasons:[],rows:[{...q,copyId:'c1',masterId:'a1',title:'Lab 3 — Consensus protocols',who:'Team A',submittedBy:'Asha Nair',submittedAt:new Date(Date.now()-7200000).toISOString(),late:true},{...q,copyId:'c2',masterId:'a1',title:'Lab 3',who:'Priya',submittedBy:null,submittedAt:new Date().toISOString(),late:false}]});`,
        '@/app/actions/moderation': `export const moderatedItemsAction=async()=>[];`,
        '@/app/actions/task-comment': `export const deleteTaskCommentAction=async()=>({success:true}),readTaskDiscussionCommentAction=async()=>({success:false}),toggleTaskCommentLikeAction=async()=>({success:true});export const readTaskDiscussionAction=async()=>({success:true,data:{comments:[],nextCursor:null,totalCount:0}});export const createTaskCommentAction=async()=>({success:true,data:{comment:null}}),readClassQuestionsAction=async()=>({success:false,error:'none'}),shareClassAnswerAction=async()=>({success:true,told:0});`,
    };
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/org-tabs.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'org-tabs-boundaries', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: 'js' }));
    } }, serverActionsPlugin] });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});

async function open(page: Page, tab: string, width = 375) {
    await page.setViewportSize({ width, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(origin + '/**', route => {
        const url = new URL(route.request().url());
        const body = url.pathname === '/app.js' ? script : url.pathname === '/app.css' ? css : '<html lang="en"><head><title>Org tabs</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
        return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto(`${origin}/?tab=${tab}`);
}

/** Nothing pushes the page sideways at phone width. */
async function noSideScroll(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('Members: requests come first on phones, rows stack, nothing scrolls sideways', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page, 'members');
    await expect(page.getByText('Student 11')).toBeVisible();
    await noSideScroll(page);
    const request = await page.getByText('Priya Natarajan').first().boundingBox();
    const roster = await page.getByText('Student 11').boundingBox();
    expect(request!.y).toBeLessThan(roster!.y);
    await expect(page.getByText(/1 of 5 done · 1 missing · active/).first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select Student 4' }).check();
    await expect(page.getByRole('group', { name: 'Bulk actions' })).toBeVisible();
    await noSideScroll(page);
    await page.getByRole('button', { name: /Alexandria Ramana Chandrasekhar/ }).click();
    await expect(page.getByRole('dialog', { name: 'Member: Alexandria Ramana Chandrasekhar' })).toBeVisible();
    await noSideScroll(page);
    expect(await page.getByRole('dialog').evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('members-375.png') });
    expect(errors).toEqual([]);
});

test('Projects, Tasks and Files fit a phone', async ({ page }) => {
    for (const [tab, text] of [['projects', 'Team Osprey'], ['tasks', 'Lab 3 — Consensus protocols'], ['files', 'Storage is 86% full']] as const) {
        await open(page, tab);
        await expect(page.getByText(text).first()).toBeVisible();
        await noSideScroll(page);
        await page.screenshot({ path: test.info().outputPath(`${tab}-375.png`), fullPage: true });
    }
    await open(page, 'projects', 1200);
    await page.getByRole('button', { name: 'cards' }).click();
    await expect(page.locator('li', { hasText: 'Team Osprey' }).getByText(/· active /)).toBeVisible();
});

test('Create wizard team (§14.4): unit lead ★, Move to…, picker filters and the Outside tab work by keyboard at phone width', async ({ page }) => {
    await open(page, 'team');
    await expect(page.getByText('Ms. Rao, Teacher')).toBeVisible();
    await noSideScroll(page);
    const star = page.getByRole('button', { name: 'Make Asha Nair team lead' });
    await star.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Asha Nair is team lead' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('combobox', { name: 'Move Ravi Kumar to…' }).selectOption({ label: 'Testing' });
    await expect(page.getByRole('combobox', { name: 'Move Ravi Kumar to…' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add people' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Asha Nair')).toBeVisible();
    await dialog.getByLabel('Not in a workspace yet').check();
    await expect(dialog.getByText('Ravi Kumar')).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Outside CSE-3A' }).click();
    await dialog.getByRole('textbox', { name: 'Search people' }).fill('cl');
    await expect(dialog.getByText('Client Person')).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath('team-375.png') });
});

test('Units panel (§14.4): rename, seats, unit lead and Move to…, all native controls, no side scroll on a phone', async ({ page }) => {
    await open(page, 'units');
    await expect(page.getByRole('textbox', { name: 'Name of Frontend developers' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Team lead of Frontend developers' })).toHaveValue('u1');
    await expect(page.getByRole('combobox', { name: 'Move to…' }).first()).toBeVisible();
    await expect(page.getByRole('option', { name: 'Developer testing unit (full)' }).first()).toBeDisabled();
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath('units-375.png') });
});

test('Assignments (§16): the review queue steps with Next; the roster has Remind, Add step and per-person team moves, on a phone', async ({ page }) => {
    await open(page, 'tasks');
    const queue = page.getByRole('region', { name: 'To review' });
    await expect(queue.getByRole('region', { name: 'Waiting' }).getByText('1 of 2', { exact: true })).toBeVisible();
    await expect(queue.getByText(/Team A · Lab 3 — Consensus protocols · .* · Late · Version 2 · handed in by Asha Nair/)).toBeVisible();
    await expect(queue).toContainText('Steps · 4 of 5 ticked');
    await expect(queue).toContainText('Note: Used Raft');
    await queue.getByRole('button', { name: 'Next' }).click();
    await expect(queue.getByRole('region', { name: 'Waiting' }).getByText('2 of 2', { exact: true })).toBeVisible();
    // Keys (23.2): K goes back, R opens the reason box with Fix by.
    await page.keyboard.press('k');
    await expect(queue.getByRole('region', { name: 'Waiting' }).getByText('1 of 2', { exact: true })).toBeVisible();
    await page.keyboard.press('r');
    await expect(queue).toContainText(/What should .+ change\?/);
    await expect(queue).toContainText('Fix by');
    await queue.getByRole('button', { name: 'Cancel' }).click();
    await noSideScroll(page);
    // Review UX 1.3: the roster's tools live in the Assignment tab itself, no pop-up.
    const tab = page.getByRole('region', { name: /^Lab 3 — Consensus protocols/ })
    await expect(tab.getByRole('button', { name: 'Remind 6' })).toBeVisible();
    await expect(tab.getByText('1 person was reminded in the last 12 hours and won’t be reminded again yet.')).toBeVisible();
    await expect(tab.getByRole('textbox', { name: 'Add a step to every copy' })).toBeVisible();
    await expect(tab.getByRole('combobox', { name: 'Move Alexandria Ramana Chandrasekhar to…' })).toBeVisible();
    await expect(tab.getByText('Ravi Kumar ★', { exact: false })).toBeVisible();
    await expect(tab.getByRole('combobox', { name: 'Add Late Joiner to a group' })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath('assignments-375.png'), fullPage: true });
    // Step 13a: Return asks for a reason and Fix by; Give to lists people without a copy.
    await tab.getByRole('button', { name: 'Return Kiran' }).click();
    const returning = page.getByRole('alertdialog');
    await expect(returning).toContainText('Fix by');
    await expect(returning).toContainText('They can hand it in again until then, even past the due date.');
    await returning.getByRole('button', { name: 'Cancel' }).click();
    await tab.getByRole('button', { name: 'Give to…' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Late Joiner');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    // Step 13c: tick rows for bulk actions.
    await tab.getByLabel('Select Kiran').check();
    const picked = tab.getByRole('group', { name: 'Selected' });
    await expect(picked).toContainText('1 selected');
    for (const name of ['Approve selected', 'Return selected', 'Extend for 1', 'Remind selected']) await expect(picked.getByRole('button', { name })).toBeVisible();
    await noSideScroll(page);
});

test('Org header (§18): + New ▾ by keyboard, tab badges with spoken text, and the compact bar with the sprint chip and New items on a phone', async ({ page }) => {
    await open(page, 'header', 1280);
    await expect(page.getByTestId('tab-badge-tasks')).toHaveText('5 waiting');
    await expect(page.getByTestId('tab-badge-members')).toHaveText('2 waiting');
    await expect(page.getByTestId('tab-badge-updates')).toHaveText('(new)');
    await page.getByTestId('org-new-menu').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Announcement' }).click();
    await expect(page.getByTestId('picked')).toHaveText('announcement');

    await open(page, 'header&active=tasks');
    await expect(page.getByText('CO1')).toBeVisible();
    await page.getByRole('button', { name: 'Workspace actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'New sprint' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Organization overview' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'New sprint' }).click();
    await expect(page.getByTestId('picked')).toHaveText('sprint');
    await noSideScroll(page);
});

test('Members (§20): bulk Remind, the Outside people filter, and the drawer has Message and Recent activity', async ({ page }) => {
    await open(page, 'members', 1280);
    await page.getByLabel('Select Student 2').check();
    await page.getByRole('group', { name: 'Bulk actions' }).getByRole('button', { name: 'Remind' }).click();
    await expect(page.getByRole('group', { name: 'Bulk actions' }), 'success clears the selection').toHaveCount(0);
    await page.getByLabel('Status').selectOption('outside');
    await expect(page.getByRole('list', { name: 'Outside people' })).toContainText('Client Person');
    await expect(page.getByRole('button', { name: 'Remove from Team Falcon' })).toBeVisible();
    // Step 11c: Former, with how it ended, who and why, and Unblock.
    await page.getByLabel('Status').selectOption('former');
    await expect(page.getByRole('list', { name: 'Former members' })).toContainText('Ms. Rao · “Repeated no-shows” · Blocked');
    await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible();
    await page.getByLabel('Status').selectOption('all');
    // The Remove dialog lists what goes and what stays, with a reason and the block.
    await page.getByLabel('Select Student 4').check();
    await page.getByRole('group', { name: 'Bulk actions' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Keep 3 submitted assignments for admins');
    await expect(page.getByRole('button', { name: 'Remove Student 4' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /^Student 5/ }).click();
    await expect(page.getByRole('link', { name: 'Message' })).toBeVisible();
    await expect(page.getByText('status changed · Lab 2')).toBeVisible();
    await page.getByLabel('Role', { exact: true }).last().selectOption('viewer');
    await expect(page.getByRole('alertdialog')).toContainText('2 open assignments are removed from their list');
});

test('Files (§23): storage nearly full, Update copy and opening an org file in place', async ({ page }) => {
    await open(page, 'files', 1280);
    await expect(page.getByTestId('org-storage')).toContainText('Storage is 86% full');
    await expect(page.getByRole('button', { name: 'Newer version · Update copy' })).toBeVisible();
    await page.getByRole('button', { name: 'Distributed-systems-capstone-rubric-final-v3.pdf', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Read only');
    await expect(page.getByRole('link', { name: 'Open in CSE-3A Software Engineering' })).toBeVisible();
});

test('Projects (§28): Stage, Lead and Sprint filters, Remind leads, Cards view with Message lead and the New badge', async ({ page }) => {
    await open(page, 'projects', 1280);
    // Step 11a: Stage, Sprint and Has open seats live in the Filters menu.
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByLabel('Sprint').selectOption('linked');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Team Falcon — Distributed Systems Capstone' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Team Osprey' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Sprint').selectOption('all');
    await page.getByLabel('Stage').selectOption('Idea');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Team Osprey' })).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Stage').selectOption('all');
    await page.keyboard.press('Escape');
    await page.getByLabel('Select Team Osprey').check();
    await page.getByRole('button', { name: 'Remind workspace lead' }).first().click();
    await page.getByRole('button', { name: 'cards' }).click();
    await expect(page.getByRole('list', { name: 'Workspaces' })).toContainText('New');
    await expect(page.getByRole('link', { name: 'Message workspace lead' }).first()).toBeVisible();
    await noSideScroll(page);
});

test('Sprint form (§28.2): an organization names the next sprint, Repeat previews, blocks an overlap and fixes it in one click', async ({ page }) => {
    await open(page, 'sprint-org', 1280);
    await expect(page.locator('#sprint-name')).toHaveValue('CO2');
    await page.locator('#sprint-start-date').fill('2027-01-04');
    await page.locator('#sprint-end-date').fill('2027-01-17');
    await page.getByRole('tab', { name: 'Several (plan the term)' }).click();
    const list = page.getByRole('list', { name: 'Sprints to create' });
    await expect(list).toContainText('CO3 · Jan 18–Jan 31 · Overlaps Mid-term break');
    await expect(page.getByRole('button', { name: 'Create 4 sprints' })).toBeDisabled();
    await page.getByRole('button', { name: 'Start after Mid-term break' }).click();
    await expect(page.locator('#sprint-start-date')).toHaveValue('2027-01-25');
    await expect(list).not.toContainText('Overlaps');
    await expect(list).toContainText('Passes the term end');
    await expect(page.getByRole('button', { name: 'Create 4 sprints' })).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('sprint-org.png') });
});

test('Sprint form (§18.2): a team sprint sits inside CO1, says its limit beside the dates, and offers the group work', async ({ page }) => {
    await open(page, 'sprint-child', 1280);
    await expect(page.getByLabel('Inside the class sprint')).toHaveValue(/.+/);
    await expect(page.getByText(/Your dates start as CO1’s \(Jan 4–Jan 17\)/)).toBeVisible();
    await expect(page.getByRole('option', { name: 'Not inside a sprint' })).toHaveCount(0);
    await expect(page.getByLabel('Also add 2 group assignments from the backlog')).toBeChecked();
    await page.locator('#sprint-end-date').fill('2027-01-20');
    await expect(page.getByRole('alert').filter({ hasText: 'CO1 ends Jan 17. Pick an earlier date.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Create / })).toBeDisabled();
    await expect(page.getByRole('tab', { name: 'Several (plan the term)' })).toHaveCount(0);
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath('sprint-child.png') });
});


test('New assignment (§42.5): publish timing choices, and Admins-only materials warn before they are added', async ({ page }) => {
    await open(page, 'compose', 1280);
    const when = page.getByLabel('When to publish');
    await expect(when.getByRole('option')).toHaveText(['Publish now', 'On a date', 'Save as draft']);
    await when.selectOption('date');
    await expect(page.getByLabel('Publish on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schedule' })).toBeVisible();
    await page.getByLabel('Search files for materials').fill('ans');
    await expect(page.getByRole('list', { name: 'Files' })).toContainText('Admins only. Members won’t be able to open this.');
    await expect(page.getByLabel('Late after, in minutes')).toHaveValue('15');
});

test('Mockup task 1, review UX 1.1–1.6: the Assignment tab shows everyone in sections, with search, sort, photos and each row\'s own actions', async ({ page }) => {
    await open(page, 'tasks', 1280);
    const panel = page.getByRole('region', { name: /^Lab 3 — Consensus protocols/ });
    await expect(panel).toContainText(/Due .+ · Open/);
    const tiles = panel.getByRole('group', { name: 'Class at a glance' });
    await expect(tiles.getByRole('button', { name: '1 Done' })).toBeVisible();
    await expect(tiles.getByRole('button', { name: '4 In review' })).toBeVisible();
    await expect(tiles.getByRole('button', { name: '7 Not in' })).toBeVisible();
    await expect(tiles.getByRole('button', { name: '0 Excused' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Review 4' })).toHaveAttribute('href', /taskScope=review&assignment=a1/);
    await expect(panel.getByRole('button', { name: 'Full roster' })).toHaveCount(0);
    const waiting = panel.getByRole('list', { name: 'Waiting for review · 1' });
    await expect(waiting.getByRole('listitem').filter({ hasText: 'Kiran' })).toContainText(/Version 2 · Late/);
    for (const name of ['Open Kiran', 'Approve Kiran', 'Return Kiran']) await expect(waiting.getByRole('button', { name }).or(waiting.getByRole('link', { name }))).toBeVisible();
    const working = panel.getByRole('list', { name: 'In progress · 1' });
    await expect(working.getByRole('listitem').filter({ hasText: 'Team A' })).toContainText(/In progress · Reminded 3 hours ago/);
    await expect(working.getByRole('button', { name: 'Extend Team A' })).toBeVisible();
    await expect(panel.getByRole('list', { name: 'Missing · 1' })).toContainText(/Missing · Changed 2 days ago/);
    await expect(panel.getByRole('heading', { name: 'Class questions' })).toBeVisible();
    // Search and Late only narrow the sections; a tile does too.
    await panel.getByRole('textbox', { name: 'Search people' }).fill('alexandria');
    await expect(working).toBeVisible();
    await expect(waiting).toHaveCount(0);
    await panel.getByRole('textbox', { name: 'Search people' }).fill('');
    await panel.getByLabel('Late only').check();
    await expect(working).toHaveCount(0);
    await expect(waiting).toBeVisible();
    await panel.getByLabel('Late only').uncheck();
    await tiles.getByRole('button', { name: '4 In review' }).click();
    await expect(working).toHaveCount(0);
    await expect(waiting).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
});

test('Live-fix 3: a draft is published, scheduled or deleted from its own card', async ({ page }) => {
    await open(page, 'tasks-draft', 1280);
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByLabel(/Publish on/)).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Delete Reading quiz?');
});

test('Edit for everyone (§23.3): says how many it reaches, and the hand-in type is locked after a submission', async ({ page }) => {
    await open(page, 'tasks', 1280);
    await page.getByRole('button', { name: 'Manage assignment' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit for everyone' }).click();
    const edit = page.getByRole('alertdialog');
    await expect(edit.getByRole('button', { name: /^Save for \d+ people$/ })).toBeVisible();
    await expect(edit).toContainText('Locked: someone has handed this in.');
    await expect(edit.getByRole('textbox').nth(1)).toHaveValue('Read chapter 3');
});

test('Accessibility (§32.3): no WCAG A or AA problems on the Members, Workspaces, Tasks and Files tabs', async ({ page }) => {
    for (const [tab, text] of [['members', 'Student 11'], ['projects', 'Team Osprey'], ['tasks', 'Lab 3 — Consensus protocols'], ['files', 'Storage is 86% full']] as const) {
        await open(page, tab, 1200);
        await expect(page.getByText(text).first()).toBeVisible();
        expect(await axeViolations(page), tab).toEqual([]);
    }
});

test('Live-fix 28: the composer\'s Post button stays inside the column at 1280px and on a phone', async ({ page }) => {
    for (const width of [1280, 375]) {
        await open(page, 'composer', width);
        await page.getByText('Share with CSE-3A…').first().click();
        const post = page.getByRole('button', { name: 'Post to 40 people' });
        await expect(post).toBeVisible();
        const column = await page.getByTestId('composer-column').boundingBox();
        const button = await post.boundingBox();
        expect(button!.x + button!.width).toBeLessThanOrEqual(column!.x + column!.width + 0.5);
        await noSideScroll(page);
    }
});

test('Board/review report §4, §5: New has Task and Assignment tabs in the profile style; what is typed carries across; Assigned to is people only', async ({ page }) => {
    await open(page, 'new', 1280);
    const tabs = page.getByRole('tablist', { name: 'What are you creating?' });
    await expect(tabs.getByRole('tab', { name: 'Task' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Select assignee').or(page.locator('#task-assignee'))).not.toContainText('an assignment');
    await page.locator('input[name="title"], textarea[name="title"]').first().fill('Lab 2: Stacks');
    await tabs.getByRole('tab', { name: 'Assignment' }).click();
    await expect(page.getByText('Everyone it goes to gets their own copy to hand in.')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Assign to' })).toBeVisible();
    await expect(page.locator('input[value="Lab 2: Stacks"]')).toBeVisible();
    await tabs.getByRole('tab', { name: 'Task' }).click();
    await expect(page.locator('[name="title"]').first()).toHaveValue('Lab 2: Stacks');
    await open(page, 'new-assignment', 1280);
    await expect(page.getByRole('tablist', { name: 'What are you creating?' }).getByRole('tab', { name: 'Assignment' })).toHaveAttribute('aria-selected', 'true');
});
