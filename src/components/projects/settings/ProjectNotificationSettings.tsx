"use client";

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
  onToggleRule: (
    eventKey: ProjectNotificationEventKey,
    enabled: boolean,
  ) => void;
  disabled: boolean;
}) {
  const enabledCount = group.entries.filter(
    (entry) =>
      resolveProjectNotificationDecision({
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
  entry: ProjectNotificationRegistryEntry,
) {
  return entry.defaultRecipients
    .map((recipient) => recipient.replace(/_/g, " "))
    .join(", ");
}
function formatProjectNotificationAggregate(
  entry: ProjectNotificationRegistryEntry,
) {
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
  const decision = resolveProjectNotificationDecision({
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
            ? "Important"
            : "Standard"}{" "}
          · {formatProjectNotificationAggregate(entry)} ·{" "}
          {formatProjectNotificationRecipients(entry)}
        </p>
        {entry.mandatory ? (
          <p className="nb-meta flex items-center gap-1.5 text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden="true" />
            Mandatory event · Always enabled
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
