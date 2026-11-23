import assert from "node:assert/strict";
import test from "node:test";
import {
    buildWorkspaceAccessImpact,
    buildWorkspaceAccessPolicy,
    buildWorkspaceMemberMutationPolicy,
    buildWorkspaceMemberRemovalPreflight,
    buildWorkspacePersonReference,
    buildWorkspaceRolePolicy,
    buildWorkspaceSettingsPreflight,
    canWorkspaceMemberUploadFiles,
    getWorkspaceMemberRoleLabel,
    isEligibleWorkspaceMember,
    isAssignableWorkspaceMember,
    getVisibleWorkspaceSettingsSections,
    isWorkspaceTabVisibleToViewer,
    normalizeWorkspaceVisibility,
    resolveAllowedWorkspaceTab,
} from "../../src/lib/workspaces/settings-policies";
import {
    OTHER_WORKSPACE_TYPE_ID,
    POPULAR_WORKSPACE_TAGS,
    WORKSPACE_TYPE_OPTIONS,
    isKnownWorkspaceType,
} from "../../src/lib/workspaces/workspace-create-options";
import { buildWorkspaceDetailMetadataInput } from "../../src/lib/workspaces/workspace-detail-metadata";
import {
    isWorkspacePubliclyReadableVisibility,
    isWorkspaceVisibility,
} from "../../src/lib/workspaces/workspace-visibility";
import {
    WORKSPACE_NOTIFICATION_EVENT_REGISTRY,
    buildDefaultWorkspaceNotificationPolicy,
    normalizeWorkspaceMemberNotificationOverrides,
    normalizeWorkspaceNotificationPolicy,
    resolveWorkspaceNotificationDecision,
    summarizeWorkspaceNotificationPolicy,
    updateActivityLevel,
    withUpdateActivityLevel,
} from "../../src/lib/notifications/workspace-policy";

test("project settings exposes enforceable Updates and hides future-only sections", () => {
    const ids = getVisibleWorkspaceSettingsSections().map((section) => section.id as string);
    assert.ok(ids.includes("general"));
    assert.ok(ids.includes("danger"));
    assert.ok(ids.includes("readme"));
    assert.ok(ids.includes("updates"));
    assert.ok(!ids.includes("automation"));
    assert.ok(!ids.includes("data"));
});

test("project access policy normalizes unknown visibility fail-closed", () => {
    assert.equal(normalizeWorkspaceVisibility("private"), "private");
    assert.equal(normalizeWorkspaceVisibility("public"), "public");
    assert.equal(normalizeWorkspaceVisibility("unlisted"), "public");
    assert.equal(normalizeWorkspaceVisibility("team-only"), "private");
    assert.equal(normalizeWorkspaceVisibility(null), "private");
    assert.equal(normalizeWorkspaceVisibility(undefined), "private");

    const policy = buildWorkspaceAccessPolicy({ visibility: "private" });
    assert.equal(policy.visibility, "private");
    assert.ok(policy.affectedAreas.some((area) => area.includes("Only the owner and approved workspace members")));
    assert.ok(policy.viewerRows.some((row) => row.viewer === "Anyone with the link"));
});

test("project visibility helper keeps private closed and treats legacy unlisted as public", () => {
    assert.equal(isWorkspacePubliclyReadableVisibility("public"), true);
    assert.equal(isWorkspacePubliclyReadableVisibility("private"), false);
    assert.equal(isWorkspacePubliclyReadableVisibility("unlisted"), true);
    assert.equal(isWorkspacePubliclyReadableVisibility("team-only"), false);
    assert.equal(isWorkspacePubliclyReadableVisibility(null), false);
    assert.equal(isWorkspaceVisibility("public"), true);
    assert.equal(isWorkspaceVisibility("private"), true);
    assert.equal(isWorkspaceVisibility("unlisted"), false);
});

test("project public tab visibility defaults keep public workspace low-noise", () => {
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "dashboard",
        isOwnerOrMember: false,
        publicTabVisibility: undefined,
    }), true);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "readme",
        isOwnerOrMember: false,
        publicTabVisibility: undefined,
    }), true);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "files",
        isOwnerOrMember: false,
        publicTabVisibility: undefined,
    }), true);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "updates",
        isOwnerOrMember: false,
        publicTabVisibility: undefined,
    }), true);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "updates",
        isOwnerOrMember: false,
        publicTabVisibility: { dashboard: true, readme: true, updates: false, files: true, sprints: false, tasks: false },
    }), false);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "tasks",
        isOwnerOrMember: false,
        publicTabVisibility: undefined,
    }), false);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "tasks",
        isOwnerOrMember: true,
        publicTabVisibility: undefined,
    }), true);
    assert.equal(isWorkspaceTabVisibleToViewer({
        tabId: "privacy",
        isOwnerOrMember: false,
        publicTabVisibility: {},
    }), false);
    assert.equal(resolveAllowedWorkspaceTab({
        requestedTab: "privacy",
        isOwnerOrMember: false,
        canManageSettings: false,
        publicTabVisibility: {},
    }), "dashboard");
    assert.equal(resolveAllowedWorkspaceTab({
        requestedTab: "privacy",
        isOwnerOrMember: true,
        canManageSettings: true,
        publicTabVisibility: {},
    }), "settings");
    assert.equal(resolveAllowedWorkspaceTab({
        requestedTab: "analytics",
        isOwnerOrMember: false,
        canManageSettings: false,
        publicTabVisibility: { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false },
    }), "dashboard");
    assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "analytics", isOwnerOrMember: true, canManageSettings: true }), "dashboard");
    // Member settings Part 1: members open Settings for Your settings; visitors don't.
    assert.equal(isWorkspaceTabVisibleToViewer({ tabId: "settings", isOwnerOrMember: true, canManageSettings: false }), true);
    assert.equal(isWorkspaceTabVisibleToViewer({ tabId: "settings", isOwnerOrMember: false, canManageSettings: false }), false);
});

test("project file upload policy keeps leaders on and respects member toggles", () => {
    assert.equal(canWorkspaceMemberUploadFiles({ role: "owner", fileUploadEnabled: false }), true);
    assert.equal(canWorkspaceMemberUploadFiles({ role: "admin", fileUploadEnabled: false }), true);
    assert.equal(canWorkspaceMemberUploadFiles({ role: "member", fileUploadEnabled: true }), true);
    assert.equal(canWorkspaceMemberUploadFiles({ role: "member", fileUploadEnabled: false }), false);
    assert.equal(canWorkspaceMemberUploadFiles({ role: "viewer", fileUploadEnabled: true }), false);
    assert.equal(canWorkspaceMemberUploadFiles({ role: "unknown", fileUploadEnabled: true }), false);
});

test("project notification policy normalizes defaults and locks mandatory events", () => {
    const quiet = buildDefaultWorkspaceNotificationPolicy("quiet");
    assert.equal(quiet.preset, "quiet");
    assert.equal(quiet.rules["members.removed"].enabled, true);
    assert.equal(quiet.rules["files.uploaded"].enabled, false);

    const normalized = normalizeWorkspaceNotificationPolicy({
        preset: "active",
        rules: {
            "members.removed": { enabled: false },
            "files.uploaded": { enabled: false },
            "unknown.event": { enabled: true },
        },
    });
    assert.equal(normalized.rules["members.removed"].enabled, true);
    assert.equal(normalized.rules["files.uploaded"].enabled, false);

    const overrides = normalizeWorkspaceMemberNotificationOverrides({
        mode: "custom",
        rules: {
            "files.uploaded": false,
            "members.removed": false,
            "unknown.event": false,
        },
    });
    assert.equal(overrides.mode, "custom");
    assert.deepEqual(overrides.rules, { "files.uploaded": false });

    assert.equal(resolveWorkspaceNotificationDecision({
        eventKey: "files.uploaded",
        projectPolicy: normalized,
        memberOverrides: overrides,
    }).enabled, false);
    assert.equal(resolveWorkspaceNotificationDecision({
        eventKey: "members.removed",
        projectPolicy: normalized,
        memberOverrides: overrides,
    }).enabled, true);

    const summary = summarizeWorkspaceNotificationPolicy(normalized);
    assert.ok(summary.visibleCount > 20);
    assert.ok(summary.mandatoryCount > 0);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["applications.review_needed"].visible, false);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["files.git_sync_status"].visible, false);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["security.protected_action"].visible, false);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["security.data_export_ready"].visible, false);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["security.delete_scheduled"].visible, false);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["updates.published"].visible, true);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["updates.comment"].visible, true);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["readme.published"].visible, true);
    assert.equal(WORKSPACE_NOTIFICATION_EVENT_REGISTRY["updates.follower_digest"].visible, false);
});

test("project access impact explains counts and transition checklist", () => {
    const privateImpact = buildWorkspaceAccessImpact({
        visibility: "private",
        membersCount: 2,
        followersCount: 3,
        openRolesCount: 1,
        pendingApplicationsCount: 4,
        activeTasksCount: 5,
    });

    assert.equal(privateImpact.visibility, "private");
    assert.ok(privateImpact.summary.some((line) => line.includes("3 followers")));
    assert.ok(privateImpact.metrics.some((metric) => metric.label === "Pending applications" && metric.value === 4));
    assert.ok(privateImpact.transitionChecklist.some((item) => item.includes("safe unavailable metadata")));

    const publicImpact = buildWorkspaceAccessImpact({ visibility: "public", openRolesCount: 2 });
    assert.ok(publicImpact.transitionChecklist.some((item) => item.includes("Restore Discover")));
});

test("project role policy excludes the current owner from transfer candidates", () => {
    const policy = buildWorkspaceRolePolicy({
        isOwner: true,
        ownerId: "owner-1",
        members: [
            { id: "owner-1", fullName: "Owner", membershipRole: "owner" },
            { id: "member-1", fullName: "Member", membershipRole: "member" },
            { id: "admin-1", fullName: "Admin", membershipRole: "admin" },
        ],
    });

    assert.deepEqual(policy.transferCandidates.map((member) => member.id).sort(), ["admin-1", "member-1"]);
    assert.equal(policy.roleCounts.owner, 1);
    assert.equal(policy.roleCounts.member, 1);
    assert.equal(policy.roleCounts.admin, 1);
    assert.equal(policy.roleLabels.admin, "Admin");
    assert.equal(policy.coLeaders[0]?.id, "admin-1");
});

test("project member mutation policy protects the true owner and permits lower-role changes", () => {
    const ownerTarget = buildWorkspaceMemberMutationPolicy({
        actorIsOwner: true,
        ownerId: "owner-1",
        targetUserId: "owner-1",
        targetRole: "owner",
    });
    assert.equal(ownerTarget.canRemove, false);
    assert.equal(ownerTarget.canChangeRole, false);
    assert.match(ownerTarget.blockedReason ?? "", /transfer ownership/i);

    const memberTarget = buildWorkspaceMemberMutationPolicy({
        actorIsOwner: true,
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
    });
    assert.equal(memberTarget.canPromoteToCoLeader, true);
    assert.equal(memberTarget.canRemove, true);
    assert.equal(memberTarget.canTransferOwnership, true);

    const nonOwnerActor = buildWorkspaceMemberMutationPolicy({
        actorIsOwner: false,
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
    });
    assert.equal(nonOwnerActor.canRemove, false);
    assert.match(nonOwnerActor.blockedReason ?? "", /only the owner and admins/i);

    const coLeaderCanManageMember = buildWorkspaceMemberMutationPolicy({
        actorIsOwner: false,
        actorRole: "admin",
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
        nextRole: "viewer",
    });
    assert.equal(coLeaderCanManageMember.canChangeRole, true);
    assert.equal(coLeaderCanManageMember.canRemove, true);

    const coLeaderCannotPromoteAdmin = buildWorkspaceMemberMutationPolicy({
        actorIsOwner: false,
        actorRole: "admin",
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
        nextRole: "admin",
    });
    assert.equal(coLeaderCannotPromoteAdmin.canChangeRole, false);
    assert.match(coLeaderCannotPromoteAdmin.blockedReason ?? "", /Admins can manage members and viewers/i);
});

test("project person resolver and removal preflight preserve former-member semantics", () => {
    assert.equal(getWorkspaceMemberRoleLabel("admin"), "Admin");
    assert.equal(isAssignableWorkspaceMember("viewer"), false);
    assert.equal(isEligibleWorkspaceMember("viewer", "mention"), true);
    assert.equal(isEligibleWorkspaceMember("viewer", "assign"), false);
    assert.equal(isEligibleWorkspaceMember("admin", "review"), true);

    const former = buildWorkspacePersonReference({
        person: { id: "member-1", fullName: "Removed Person" },
        membershipRole: "member",
        isActiveMember: false,
    });
    assert.equal(former.state, "former_member");
    assert.equal(former.subtext, "Removed from workspace");
    assert.equal(former.isAssignable, false);

    const preflight = buildWorkspaceMemberRemovalPreflight({
        member: { id: "member-1", fullName: "Removed Person", membershipRole: "member" },
        visibility: "private",
        activeAssignedTasks: 2,
        activeCreatedTasks: 1,
        fileReviews: 3,
        acceptedApplications: 1,
        projectGroupParticipant: true,
    });
    assert.equal(preflight.defaultMode, "preserve_history");
    assert.ok(preflight.warnings.some((warning) => warning.includes("Needs reassignment")));
    assert.ok(preflight.affectedAreas.some((area) => area.includes("Private workspace access is revoked")));
});

test("project danger preflight removes finalize and keeps archive/delete policy", () => {
    const policy = buildWorkspaceSettingsPreflight({
        status: "active",
        openRolesCount: 2,
        pendingApplicationsCount: 1,
        activeTasksCount: 4,
        canArchive: true,
        canDelete: true,
    });

    assert.equal(policy.status, "active");
    assert.equal(policy.canArchive, true);
    assert.equal(policy.canDelete, true);
    assert.ok(policy.affectedAreas.includes("2 open roles"));
    assert.ok(policy.affectedAreas.includes("1 pending application"));
    assert.ok(policy.affectedAreas.includes("4 active tasks"));
    assert.ok(!("canFinalize" in policy));

    const missingServerPreflight = buildWorkspaceSettingsPreflight(null);
    assert.equal(missingServerPreflight.canDelete, false);
});

test("project metadata uses uploaded cover image for share previews", () => {
    const withCover = buildWorkspaceDetailMetadataInput("network-for-builders", {
        slug: "network-for-builders",
        title: "Network for builders",
        coverImage: "https://cdn.example.test/network-cover.png",
    });
    assert.equal(withCover.image, "https://cdn.example.test/network-cover.png");

    const withoutCover = buildWorkspaceDetailMetadataInput("network-for-builders", {
        slug: "network-for-builders",
        title: "Network for builders",
        coverImage: null,
    });
    assert.equal(withoutCover.image, "/api/og/workspace/network-for-builders");
});

test("the per-workspace update setting maps to rules, and reads back", () => {
    const base = { version: 1 as const, mode: "inherit" as const, rules: {} };
    assert.equal(updateActivityLevel(base), "all");
    for (const level of ["all", "about_me", "nothing"] as const) {
        const next = withUpdateActivityLevel(base, level);
        assert.equal(next.mode, "custom");
        assert.equal(updateActivityLevel(next), level);
    }
    const aboutMe = withUpdateActivityLevel(base, "about_me");
    assert.equal(aboutMe.rules["updates.team_activity"], false);
    assert.equal(aboutMe.rules["updates.mention"], true);
    assert.equal(withUpdateActivityLevel(base, "nothing").rules["updates.reply"], false);
});
