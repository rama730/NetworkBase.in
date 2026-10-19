'use client';

import { useMemo } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    resolveProjectNotificationDecision,
    type ProjectNotificationEventKey,
    type ProjectNotificationGroupId,
    type ProjectNotificationPolicy,
    type ProjectNotificationRegistryEntry,
} from "@/lib/notifications/project-policy";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

export function ProjectNotificationCategoryCard({
    group,
    policy,
    isExpanded,
    onToggleExpand,
    onToggleRule,
    disabled,
}: {
    group: {
        id: ProjectNotificationGroupId;
        title: string;
        description: string;
        entries: ProjectNotificationRegistryEntry[];
    };
    policy: ProjectNotificationPolicy;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onToggleRule: (eventKey: ProjectNotificationEventKey, enabled: boolean) => void;
    disabled: boolean;
}) {
    const enabledCount = useMemo(() => {
        return group.entries.filter((entry) => {
            const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy: policy });
            return decision.enabled;
        }).length;
    }, [group.entries, policy]);

    const mandatoryCount = useMemo(() => {
        return group.entries.filter((entry) => entry.mandatory).length;
    }, [group.entries]);

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden transition-colors">
            <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={isExpanded}
                aria-controls={`notification-group-${group.id}`}
                className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="nb-ui-label text-sm font-semibold text-foreground">
                            {group.title}
                        </span>
                        <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                            {enabledCount}/{group.entries.length} Active
                        </span>
                        {mandatoryCount > 0 ? (
                            <span className="inline-flex h-5 items-center gap-1 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                                <Lock className="size-3" />
                                {mandatoryCount} Mandatory
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-0.5 nb-compact text-xs text-muted-foreground truncate">
                        {group.description}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ChevronDown
                        className={cn(
                            "size-4 text-muted-foreground transition-transform duration-200",
                            isExpanded && "rotate-180 text-foreground"
                        )}
                    />
                </div>
            </button>

            {isExpanded && (
                <div
                    id={`notification-group-${group.id}`}
                    className="border-t border-border divide-y divide-border bg-muted/5"
                >
                    {group.entries.map((entry) => (
                        <ProjectNotificationRuleRow
                            key={entry.key}
                            entry={entry}
                            policy={policy}
                            disabled={disabled}
                            onToggle={onToggleRule}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function formatProjectNotificationRecipients(entry: ProjectNotificationRegistryEntry) {
    return entry.defaultRecipients.map((recipient) => recipient.replace(/_/g, " "));
}

function formatProjectNotificationAggregate(entry: ProjectNotificationRegistryEntry) {
    if (entry.aggregate === "burst_10m") return "10m burst";
    if (entry.aggregate === "digest_only") return "Digest";
    return "Realtime";
}

function ProjectNotificationRuleRow({
    entry,
    policy,
    disabled,
    onToggle,
}: {
    entry: ProjectNotificationRegistryEntry;
    policy: ProjectNotificationPolicy;
    disabled: boolean;
    onToggle: (eventKey: ProjectNotificationEventKey, enabled: boolean) => void;
}) {
    const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy: policy });
    const enabled = decision.enabled;
    return (
        <div className="flex items-center justify-between gap-4 p-3.5 transition-colors hover:bg-muted/10">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="nb-ui-label text-sm font-semibold text-foreground">{entry.label}</p>
                    {entry.mandatory ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                            <Lock className="size-3" />
                            Mandatory
                        </span>
                    ) : null}
                    <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                        {policy.rules[entry.key]?.importance === "important" ? "Important" : "Standard"}
                    </span>
                    <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                        {formatProjectNotificationAggregate(entry)}
                    </span>
                </div>
                <p className="mt-1 nb-compact text-xs text-muted-foreground leading-relaxed">{entry.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {formatProjectNotificationRecipients(entry).map((recipient) => (
                        <span key={recipient} className="inline-flex h-5 items-center rounded-[3px] border border-primary/20 bg-primary/10 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-primary">
                            {recipient}
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                    {enabled ? "On" : "Off"}
                </span>
                <SettingsSwitch
                    checked={enabled}
                    disabled={disabled || entry.mandatory}
                    aria-label={entry.label}
                    onCheckedChange={(nextEnabled) => onToggle(entry.key, nextEnabled)}
                />
            </div>
        </div>
    );
}
