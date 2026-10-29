'use client';

import React from "react";
import {
    buildWorkspaceAccessTransitionPolicy,
    type WorkspaceSettingsMember,
    type WorkspaceSettingsVisibility,
} from "@/lib/workspaces/settings-policies";

export type AccessImpact = {
    membersCount: number;
    followersCount: number;
    openRolesCount: number;
    pendingApplicationsCount: number;
    activeTasksCount: number;
};

export type AccessTransitionPreflightData = {
    previousVisibility: WorkspaceSettingsVisibility;
    nextVisibility: WorkspaceSettingsVisibility;
    confirmationToken: string;
    policy: ReturnType<typeof buildWorkspaceAccessTransitionPolicy>;
    counts: AccessImpact;
    previews: {
        followers: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
        openRoles: Array<{ id: string; title: string | null; role: string | null }>;
        pendingApplications: Array<{ id: string; applicantId: string; applicantName: string | null; roleTitle: string | null; roleName: string | null }>;
    };
};


export type RemovalPreflightData = {
    member: WorkspaceSettingsMember;
    activeAssignedTasks: number;
    activeCreatedTasks: number;
    fileReviews: number;
    acceptedApplications: number;
    projectGroupParticipant: boolean;
    visibility: WorkspaceSettingsVisibility;
    activeAssignedTaskItems?: Array<{ id: string; title: string; taskNumber: number | null; status: string | null }>;
    activeCreatedTaskItems?: Array<{ id: string; title: string; taskNumber: number | null; status: string | null }>;
    fileReviewItems?: Array<{ id: string; taskId: string; taskTitle: string | null; nodeName: string | null; annotation: string | null }>;
    acceptedApplicationItems?: Array<{ id: string; roleId: string; roleTitle: string | null; roleName: string | null }>;
    reassignmentCandidates?: WorkspaceSettingsMember[];
};
type RemovalTaskPreview = { id: string; title: string; taskNumber: number | null; status: string | null };

function formatTaskPreviewLabel(task: RemovalTaskPreview) {
    const number = typeof task.taskNumber === "number" ? `#${task.taskNumber}` : "Task";
    return `${number} · ${task.title}`;
}

export function RemovalImpactDetails({ preflight }: { preflight: RemovalPreflightData }) {
    const sections: Array<{
        key: string;
        label: string;
        count: number;
        items: React.ReactNode[];
        empty: string;
    }> = [
        {
            key: "assigned",
            label: "Active assigned tasks",
            count: preflight.activeAssignedTasks,
            items: (preflight.activeAssignedTaskItems ?? []).map((task) => (
                <li key={task.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">{formatTaskPreviewLabel(task)}</span>
                    <span className="nb-meta text-[11px] text-muted-foreground">{task.status ?? "active"} · will need reassignment if history is preserved</span>
                </li>
            )),
            empty: "No active assigned tasks.",
        },
        {
            key: "created",
            label: "Created active tasks",
            count: preflight.activeCreatedTasks,
            items: (preflight.activeCreatedTaskItems ?? []).map((task) => (
                <li key={task.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">{formatTaskPreviewLabel(task)}</span>
                    <span className="nb-meta text-[11px] text-muted-foreground">{task.status ?? "active"} · creator history stays visible</span>
                </li>
            )),
            empty: "No active tasks created by this member.",
        },
        {
            key: "reviews",
            label: "File review responsibilities",
            count: preflight.fileReviews,
            items: (preflight.fileReviewItems ?? []).map((review) => (
                <li key={review.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">
                        {review.nodeName ?? "Linked file"} · {review.taskTitle ?? "Task"}
                    </span>
                    <span className="nb-meta text-[11px] text-muted-foreground">{review.annotation ?? "Needs review"}</span>
                </li>
            )),
            empty: "No file review responsibilities found.",
        },
        {
            key: "applications",
            label: "Accepted application history",
            count: preflight.acceptedApplications,
            items: (preflight.acceptedApplicationItems ?? []).map((application) => (
                <li key={application.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">
                        {application.roleTitle ?? application.roleName ?? "Accepted role"}
                    </span>
                    <span className="nb-meta text-[11px] text-muted-foreground">Will show Accepted · Membership ended</span>
                </li>
            )),
            empty: "No accepted application history found.",
        },
    ];

    return (
        <details className="rounded-lg border border-border bg-muted/20 p-3">
            <summary className="cursor-pointer nb-micro text-muted-foreground">
                Exact affected records
            </summary>
            <div className="mt-3 space-y-3">
                {sections.map((section) => (
                    <div key={section.key}>
                        <p className="nb-ui-label text-xs font-semibold text-foreground">
                            {section.label} <span className="nb-meta text-muted-foreground">({section.count})</span>
                        </p>
                        {section.items.length > 0 ? (
                            <ul className="mt-2 space-y-1.5 text-xs">{section.items}</ul>
                        ) : (
                            <p className="nb-compact mt-1 text-xs text-muted-foreground">{section.empty}</p>
                        )}
                        {section.count > section.items.length ? (
                            <p className="nb-meta mt-1 text-[11px] text-muted-foreground">
                                Showing the first {section.items.length}; the action still applies to all {section.count}.
                            </p>
                        ) : null}
                    </div>
                ))}
            </div>
        </details>
    );
}

export function AccessTransitionDetails({ preflight }: { preflight: AccessTransitionPreflightData }) {
    const previewRows = [
        {
            label: "Followers",
            items: preflight.previews.followers.map((follower) => follower.fullName || follower.username || "Follower"),
            fallback: "No follower previews are affected.",
        },
        {
            label: "Open roles",
            items: preflight.previews.openRoles.map((role) => role.title || role.role || "Open role"),
            fallback: "No open role previews are affected.",
        },
        {
            label: "Pending applications",
            items: preflight.previews.pendingApplications.map((application) => {
                const roleLabel = application.roleTitle || application.roleName || "role";
                return `${application.applicantName || "Applicant"} · ${roleLabel}`;
            }),
            fallback: "No pending application previews are affected.",
        },
    ];

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="nb-ui-label text-sm font-semibold text-foreground">Affected counts</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                        ["Members", preflight.counts.membersCount],
                        ["Followers", preflight.counts.followersCount],
                        ["Open roles", preflight.counts.openRolesCount],
                        ["Pending applications", preflight.counts.pendingApplicationsCount],
                        ["Active tasks", preflight.counts.activeTasksCount],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                            <span className="font-semibold text-foreground">{value}</span>
                            <span className="ml-2 text-muted-foreground">{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <p className="nb-micro text-muted-foreground">Transition checklist</p>
                <PolicyList items={preflight.policy.transitionChecklist} />
            </div>

            {preflight.policy.irreversibleNotes.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                    <p className="font-semibold">Important notes</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                        {preflight.policy.irreversibleNotes.map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="grid gap-3">
                {previewRows.map((row) => (
                    <div key={row.label} className="rounded-lg border border-border p-3">
                        <p className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">{row.label}</p>
                        {row.items.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {row.items.map((item, index) => (
                                    <span key={`${row.label}-${index}-${item}`} className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-foreground">
                                        {item}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="nb-compact mt-2 text-xs text-muted-foreground">{row.fallback}</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function PolicyList({ items }: { items: string[] }) {
    return (
        <ul className="grid gap-2">
            {items.map((item) => (
                <li key={item} className="rounded-lg border border-border bg-muted/20 px-3.5 py-2.5 text-sm text-foreground">
                    <span className="leading-relaxed">{item}</span>
                </li>
            ))}
        </ul>
    );
}
