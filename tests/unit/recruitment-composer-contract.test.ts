import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("all recruitment entry points use the Invite members surface", () => {
    const composer = source("src/components/workspaces/dashboard/InviteCollaboratorModal.tsx");
    const applicationEntry = source("src/components/workspaces/ApplyRoleModal.tsx");
    const profileInviteEntry = source("src/components/profile/v2/ProfileInviteModal.tsx");
    const guidance = source("src/app/actions/workspace/guidance.ts");

    assert.match(composer, /mode\?: "invite" \| "apply"/);
    assert.match(composer, /createWorkspaceInvitationAction/);
    assert.match(composer, /applyToRoleAction/);
    assert.match(composer, /Search connections or people/);
    assert.match(composer, /Invite as mentor/);
    assert.match(composer, /query\.length < 2/);
    assert.match(composer, /recruitment-application-draft:v2:\$\{user\?\.id/);
    assert.match(composer, /crypto\.subtle\.digest\("SHA-256"/);
    assert.match(composer, /getWorkspaceGuidancePreflightAction/);
    assert.match(composer, /queryLengthBucket/);
    assert.match(composer, /searchCache/);
    assert.match(composer, /guidancePreflightCache/);
    assert.match(composer, /aria-busy=\{loadingOptions \|\| searching\}/);
    assert.match(composer, /recruitment\.composer\.options/);
    assert.match(composer, /recruitment\.composer\.guidance_preflight/);
    assert.match(composer, /showProjectPicker/);
    assert.match(composer, /setIsChoosingProject\(\(open\) => !open\)/);
    assert.match(composer, /isChoosingProject \? "Cancel" : "Change"/);
    assert.match(composer, /role="listbox"/);
    assert.match(composer, /absolute inset-x-0 top-full/);
    assert.doesNotMatch(composer, /selectedProjectId && !showProjectPicker/);
    assert.doesNotMatch(composer, /<select ref=\{projectSelectRef\}/);
    assert.match(guidance, /export async function getWorkspaceGuidancePreflightAction/);
    assert.match(guidance, /project\.ownerId !== user\.id/);
    assert.match(guidance, /notExists\(db/);
    assert.match(applicationEntry, /InviteCollaboratorModal[\s\S]*mode="apply"/);
    assert.match(profileInviteEntry, /InviteCollaboratorModal/);
});

test("application entry points exclude existing project members", () => {
    const profilePage = source("src/app/(site)/(main)/u/[username]/page.tsx");
    const projectAction = projectActionsSource();
    const dashboard = source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");

    // The viewer to exclude comes from the session, never from the caller (COR-044).
    assert.match(profilePage, /getProfileWorkspacesWithOpenRolesAction\(data\.profile\.id\)/);
    assert.match(projectAction, /const \{ userId: excludeMemberUserId \} = await getViewerAuthContext\(\)/);
    assert.match(projectAction, /NOT EXISTS \([\s\S]*workspace_members AS excluded_member/);
    assert.match(dashboard, /Workspace members cannot apply for an additional role/);
});

test("recruitment search preserves the rate limit for incomplete queries and filters members in SQL", () => {
    const guidance = source("src/app/actions/workspace/guidance.ts");
    const search = guidance.slice(guidance.indexOf("export async function searchWorkspaceInviteCandidatesAction"));

    assert.ok(search.indexOf('if (query && query.length < 2)') < search.indexOf('consumeRateLimit'));
    assert.match(search, /isNotProjectMember = notExists/);
    assert.doesNotMatch(search, /memberRows/);
});

test("invitation expiry uses the database clock in raw SQL", () => {
    const guidance = source("src/app/actions/workspace/guidance.ts");
    const invitations = source("src/lib/workspaces/workspace-invitations.ts");

    assert.match(invitations, /expiresAt\} <= now\(\)/);
    assert.match(guidance, /expiresAt\} <= now\(\)/);
    assert.match(guidance, /expiresAt\} > now\(\)/);
    assert.doesNotMatch(invitations, /expiresAt\} <= \$\{now\}/);
    assert.doesNotMatch(guidance, /expiresAt\}\s*(?:<=|>)\s*\$\{now\}/);
});

test("guidance invitations use the existing Open Roles invitation lifecycle", () => {
    const statusAction = source("src/app/actions/applications/internal.ts");
    const dashboard = source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");
    const openRoles = source("src/components/workspaces/dashboard/OpenRolesCard.tsx");
    const applicationCard = source("src/components/messages/cards/MessageCard.tsx");

    assert.match(statusAction, /db\.query\.workspaceInvitations\.findFirst/);
    assert.match(statusAction, /invitationKind: durableInvitation\.kind/);
    assert.match(statusAction, /invitationId: durableInvitation\.id/);
    assert.match(statusAction, /guidanceLabel \|\| "Mentor"/);
    assert.match(dashboard, /resolveWorkspaceInvitationAction/);
    assert.match(dashboard, /applicationStatus\.invitationId/);
    assert.doesNotMatch(dashboard, /rolesWithFilled\.length === 0\) return/);
    assert.match(openRoles, /applicationStatus\.invitationKind === "guidance_appointment"/);
    assert.match(openRoles, /openRoles\.length === 0 && !isGuidanceInvitation && !hasMyApplication\) return null/);
    assert.doesNotMatch(openRoles, /No open positions listed/);
    assert.match(openRoles, />\s*Invited\s*</);
    assert.match(openRoles, /\bAccept\b/);
    assert.match(openRoles, /\bDecline\b/);
    assert.doesNotMatch(applicationCard, />\s*View Profile\s*</);
});
