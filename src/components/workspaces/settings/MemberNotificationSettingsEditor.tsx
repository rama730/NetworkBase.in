'use client';
import { PixelBeat } from "@/components/ui/PixelBeat";

import React, { useMemo } from "react";
import {
    Lock,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    groupWorkspaceNotificationEntries,
    resolveWorkspaceNotificationDecision,
    type WorkspaceMemberNotificationOverrides,
    type WorkspaceNotificationPolicy,
    type WorkspaceNotificationRegistryEntry,
    type UpdateActivityLevel,
    updateActivityLevel,
    withUpdateActivityLevel,
} from "@/lib/notifications/workspace-policy";
import { type WorkspaceMemberRole } from "@/lib/workspaces/settings-policies";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

export type MemberNotificationSettingsData = {
    member: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        membershipRole: WorkspaceMemberRole;
    };
    canEdit: boolean;
    overrides: WorkspaceMemberNotificationOverrides;
};

const UPDATE_ACTIVITY_CHOICES: Array<{ id: UpdateActivityLevel; label: string; description: string }> = [
    { id: "all", label: "All activity", description: "What’s about you, plus one grouped row per post for the team’s updates." },
    { id: "about_me", label: "Only what’s about me", description: "Comments and likes on your updates, replies to you and mentions." },
    { id: "nothing", label: "Nothing", description: "No notifications about updates in this workspace." },
];

export function MemberNotificationSettingsEditor({
    data,
    draft,
    isLoading,
    isSaving,
    projectPolicy,
    onDraftChange,
    onSave,
    onReset,
}: {
    data: MemberNotificationSettingsData | null;
    draft: WorkspaceMemberNotificationOverrides;
    isLoading: boolean;
    isSaving: boolean;
    projectPolicy: WorkspaceNotificationPolicy;
    onDraftChange: React.Dispatch<React.SetStateAction<WorkspaceMemberNotificationOverrides>>;
    onSave: () => void | Promise<void>;
    onReset: () => void | Promise<void>;
}) {
    const groups = useMemo(() => groupWorkspaceNotificationEntries(), []);
    const memberName = data?.member.fullName || data?.member.username || data?.member.id || "Member";

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                <PixelBeat />
                Loading member notification preferences…
            </div>
        );
    }

    if (!data) {
        return (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                Member notification preferences are unavailable.
            </p>
        );
    }

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-semibold text-foreground">{memberName}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {data.canEdit
                        ? "Members can turn off optional notifications. Required ones stay on."
                        : "The owner and admins can see this member’s settings. Only the member can change them."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {([
                        ["inherit", "Use workspace defaults"],
                        ["custom", "Customize"],
                    ] as const).map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            aria-pressed={draft.mode === mode}
                            disabled={!data.canEdit}
                            onClick={() => onDraftChange((current) => ({ ...current, mode }))}
                            className={cn(
                                "nb-touch-target h-[28px] inline-flex items-center shrink-0 whitespace-nowrap rounded-[5px] px-3 text-xs font-medium transition-colors",
                                draft.mode === mode
                                    ? "bg-foreground text-background shadow-xs"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div role="group" aria-label="Activity on updates" className="rounded-lg border border-border bg-card p-4">
                <p className="font-semibold text-foreground">Activity on updates</p>
                <div className="mt-2 flex flex-wrap gap-2">
                    {UPDATE_ACTIVITY_CHOICES.map((choice) => {
                        const selected = updateActivityLevel(draft) === choice.id;
                        return (
                            <button
                                key={choice.id}
                                type="button"
                                aria-pressed={selected}
                                disabled={!data.canEdit}
                                onClick={() => onDraftChange((current) => withUpdateActivityLevel(current, choice.id))}
                                className={cn(
                                    "nb-touch-target h-[28px] inline-flex items-center shrink-0 whitespace-nowrap rounded-[5px] px-3 text-xs font-medium transition-colors",
                                    selected ? "bg-foreground text-background shadow-xs" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                            >
                                {choice.label}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {UPDATE_ACTIVITY_CHOICES.find((choice) => choice.id === updateActivityLevel(draft))?.description}
                </p>
            </div>

            {draft.mode === "custom" ? (
                <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1 app-scroll app-scroll-y app-scroll-gutter">
                    {groups.map((group) => (
                        <div key={group.id} className="rounded-lg border border-border overflow-hidden">
                            <div className="border-b border-border bg-muted/30 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</p>
                            </div>
                            <div className="divide-y divide-border bg-card">
                                {group.entries.map((entry) => (
                                    <MemberNotificationRuleRow
                                        key={entry.key}
                                        entry={entry}
                                        projectPolicy={projectPolicy}
                                        draft={draft}
                                        canEdit={data.canEdit}
                                        onDraftChange={onDraftChange}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
                    This member inherits the workspace-level policy. Changes to workspace defaults will automatically apply to optional triggers.
                </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving || !data.canEdit}
                    onClick={() => void onReset()}
                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium border-border hover:bg-muted/50"
                >
                    Reset to workspace defaults
                </Button>
                <Button pending={isSaving}
                    type="button"
                    disabled={isSaving || !data.canEdit}
                    onClick={() => void onSave()}
                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium"
                >
                    Save member settings
                </Button>
            </div>
        </div>
    );
}

function MemberNotificationRuleRow({
    entry,
    projectPolicy,
    draft,
    canEdit,
    onDraftChange,
}: {
    entry: WorkspaceNotificationRegistryEntry;
    projectPolicy: WorkspaceNotificationPolicy;
    draft: WorkspaceMemberNotificationOverrides;
    canEdit: boolean;
    onDraftChange: React.Dispatch<React.SetStateAction<WorkspaceMemberNotificationOverrides>>;
}) {
    const decision = resolveWorkspaceNotificationDecision({ eventKey: entry.key, projectPolicy, memberOverrides: draft });
    const projectDecision = resolveWorkspaceNotificationDecision({ eventKey: entry.key, projectPolicy });
    const disabled = !canEdit || entry.mandatory || !entry.allowMemberOverride || !projectDecision.enabled;
    const checked = decision.enabled;

    return (
        <div className="flex items-center justify-between gap-4 p-3 bg-card transition-colors hover:bg-muted/20">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="nb-ui-label text-sm font-semibold text-foreground">{entry.label}</p>
                    {entry.mandatory ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                            <Lock className="size-3" />
                            Locked
                        </span>
                    ) : null}
                </div>
                <p className="nb-compact mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {entry.mandatory
                        ? "Always on for owners and admins."
                        : !projectDecision.enabled
                            ? "Disabled by workspace defaults."
                            : entry.allowMemberOverride
                                ? "Optional personal preference."
                                : "Set by the workspace."}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                    {checked ? "On" : "Off"}
                </span>
                <SettingsSwitch
                    checked={checked}
                    disabled={disabled}
                    aria-label={entry.label}
                    onCheckedChange={(enabled) => {
                        onDraftChange((current) => ({
                            ...current,
                            mode: "custom",
                            rules: {
                                ...current.rules,
                                [entry.key]: enabled,
                            },
                        }));
                    }}
                />
            </div>
        </div>
    );
}
