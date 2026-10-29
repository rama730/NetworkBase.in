'use client';

import React, { useMemo } from "react";
import {
    Loader2,
    Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    groupProjectNotificationEntries,
    resolveProjectNotificationDecision,
    type ProjectMemberNotificationOverrides,
    type ProjectNotificationPolicy,
    type ProjectNotificationRegistryEntry,
} from "@/lib/notifications/project-policy";
import { type ProjectMemberRole } from "@/lib/projects/settings-policies";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

export type MemberNotificationSettingsData = {
    member: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        membershipRole: ProjectMemberRole;
    };
    canEdit: boolean;
    overrides: ProjectMemberNotificationOverrides;
};

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
    draft: ProjectMemberNotificationOverrides;
    isLoading: boolean;
    isSaving: boolean;
    projectPolicy: ProjectNotificationPolicy;
    onDraftChange: React.Dispatch<React.SetStateAction<ProjectMemberNotificationOverrides>>;
    onSave: () => void | Promise<void>;
    onReset: () => void | Promise<void>;
}) {
    const groups = useMemo(() => groupProjectNotificationEntries(), []);
    const memberName = data?.member.fullName || data?.member.username || data?.member.id || "Member";

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
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
                    This member inherits the project-level policy. Changes to project defaults will automatically apply to optional triggers.
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
                    Reset to project defaults
                </Button>
                <Button
                    type="button"
                    disabled={isSaving || !data.canEdit}
                    onClick={() => void onSave()}
                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium"
                >
                    {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
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
    entry: ProjectNotificationRegistryEntry;
    projectPolicy: ProjectNotificationPolicy;
    draft: ProjectMemberNotificationOverrides;
    canEdit: boolean;
    onDraftChange: React.Dispatch<React.SetStateAction<ProjectMemberNotificationOverrides>>;
}) {
    const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy, memberOverrides: draft });
    const projectDecision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy });
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
                            ? "Disabled by project defaults."
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
