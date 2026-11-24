"use client";

import { DELIVERY_LEVEL_LABELS } from "@/lib/copy/terms";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveWorkspaceNotificationDecision,
  type WorkspaceNotificationEventKey,
  type WorkspaceNotificationGroupId,
  type WorkspaceNotificationPolicy,
  type WorkspaceNotificationRegistryEntry,
} from "@/lib/notifications/workspace-policy";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

export function WorkspaceNotificationCategoryCard({
  group,
  policy,
  isExpanded,
  onToggleExpand,
  onToggleRule,
  disabled,
}: {
  group: {
    id: WorkspaceNotificationGroupId;
    title: string;
    description: string;
    entries: WorkspaceNotificationRegistryEntry[];
  };
  policy: WorkspaceNotificationPolicy;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleRule: (
    eventKey: WorkspaceNotificationEventKey,
    enabled: boolean,
  ) => void;
  disabled: boolean;
}) {
  const enabledCount = group.entries.filter(
    (entry) =>
      resolveWorkspaceNotificationDecision({
        eventKey: entry.key,
        projectPolicy: policy,
      }).enabled,
  ).length;
  const mandatoryCount = group.entries.filter(
    (entry) => entry.mandatory,
  ).length;
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-controls={`notification-group-${group.id}`}
        className="flex w-full items-center justify-between gap-3 py-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="min-w-0 space-y-1">
          <span className="nb-ui-label text-foreground">{group.title}</span>
          <p className="nb-compact text-muted-foreground">
            {group.description}
          </p>
          <p className="nb-meta text-muted-foreground">
            {enabledCount}/{group.entries.length} enabled
            {mandatoryCount ? ` · ${mandatoryCount} mandatory` : ""}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            isExpanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {isExpanded ? (
        <div
          id={`notification-group-${group.id}`}
          className="divide-y divide-border border-t border-border"
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
      ) : null}
    </div>
  );
}

function formatProjectNotificationRecipients(
  entry: WorkspaceNotificationRegistryEntry,
) {
  return entry.defaultRecipients
    .map((recipient) => recipient.replace(/_/g, " "))
    .join(", ");
}
function formatProjectNotificationAggregate(
  entry: WorkspaceNotificationRegistryEntry,
) {
  if (entry.aggregate === "burst_10m") return "Grouped every 10 minutes";
  if (entry.aggregate === "digest_only") return DELIVERY_LEVEL_LABELS.digest;
  return DELIVERY_LEVEL_LABELS.realtime;
}
function ProjectNotificationRuleRow({
  entry,
  policy,
  disabled,
  onToggle,
}: {
  entry: WorkspaceNotificationRegistryEntry;
  policy: WorkspaceNotificationPolicy;
  disabled: boolean;
  onToggle: (eventKey: WorkspaceNotificationEventKey, enabled: boolean) => void;
}) {
  const decision = resolveWorkspaceNotificationDecision({
    eventKey: entry.key,
    projectPolicy: policy,
  });
  return (
    <div className="flex min-h-16 items-start justify-between gap-4 py-3 sm:items-center">
      <div className="min-w-0 space-y-1">
        <p className="nb-ui-label text-foreground">{entry.label}</p>
        <p className="nb-compact text-muted-foreground">{entry.description}</p>
        <p className="nb-meta text-muted-foreground">
          {policy.rules[entry.key]?.importance === "important"
            ? DELIVERY_LEVEL_LABELS.important
            : DELIVERY_LEVEL_LABELS.standard}{" "}
          · {formatProjectNotificationAggregate(entry)} ·{" "}
          {formatProjectNotificationRecipients(entry)}
        </p>
        {entry.mandatory ? (
          <p className="nb-meta flex items-center gap-1.5 text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden="true" />
            {DELIVERY_LEVEL_LABELS.mandatory} · Always on
          </p>
        ) : null}
      </div>
      <SettingsSwitch
        checked={decision.enabled}
        showLabel
        disabled={disabled || entry.mandatory}
        aria-label={entry.label}
        onCheckedChange={(enabled) => onToggle(entry.key, enabled)}
      />
    </div>
  );
}
