"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { CollaboratorSearchField } from "./CollaboratorSearchField";
import {
  buildProjectFilePolicy,
  getProjectMemberDisplayName,
  getProjectMemberRoleLabel,
  type ProjectSettingsMember,
} from "@/lib/projects/settings-policies";
import type { FilePermissionFilter } from "@/lib/projects/file-permission-pagination";

export type FileAccessSettingsData = {
  members: Array<
    ProjectSettingsMember & {
      fileUploadEnabled: boolean;
      uploadPermissionLocked: boolean;
      uploadPermissionLabel: string;
    }
  >;
  summary: {
    alwaysAllowedCount: number;
    enabledMemberCount: number;
    disabledMemberCount: number;
  };
  hasMore?: boolean;
  nextCursor?: string | null;
};

export function formatJoinedAt(value?: string | null) {
  if (!value) return "Joined date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Joined date unavailable"
    : `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

export function FileAccessMembers({
  data,
  isLoading,
  savingMemberId,
  bulkSaving,
  onToggle,
  onBulkToggle,
  filePolicy,
  permissionFilter,
  onQueryChange,
  onFilterChange,
  onLoadMore,
  loadingMore,
}: {
  data: FileAccessSettingsData | null;
  isLoading: boolean;
  savingMemberId: string | null;
  bulkSaving: boolean;
  onToggle: (
    member: FileAccessSettingsData["members"][number],
    enabled: boolean,
  ) => void | Promise<void>;
  onBulkToggle: (enabled: boolean) => boolean | void | Promise<boolean | void>;
  filePolicy: ReturnType<typeof buildProjectFilePolicy>;
  query: string;
  permissionFilter: FilePermissionFilter;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: FilePermissionFilter) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const [bulkChoice, setBulkChoice] = useState<boolean | null>(null);
  const members = data?.members ?? [];
  const disabled =
    bulkSaving || Boolean(savingMemberId) || isLoading || loadingMore;
  const totalMembers =
    (data?.summary.enabledMemberCount ?? 0) +
    (data?.summary.disabledMemberCount ?? 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <CollaboratorSearchField
          disabled={bulkSaving || Boolean(savingMemberId)}
          onCommit={onQueryChange}
          label="Search file permissions"
          placeholder="Search members by name or username…"
        />
        <label className="nb-compact flex shrink-0 items-center gap-2">
          Uploads
          <select
            value={permissionFilter}
            onChange={(event) =>
              onFilterChange(event.target.value as FilePermissionFilter)
            }
            className="h-[34px] rounded-[5px] border border-border bg-card px-2"
            disabled={bulkSaving || Boolean(savingMemberId)}
          >
            <option value="all">All members</option>
            <option value="enabled">Enabled members</option>
            <option value="disabled">Disabled members</option>
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="nb-meta text-muted-foreground">
          {members.length} loaded · Totals include everyone on the project
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !totalMembers}
            onClick={() => setBulkChoice(true)}
          >
            Enable all members
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !totalMembers}
            onClick={() => setBulkChoice(false)}
          >
            Disable all members
          </Button>
        </div>
      </div>
      {isLoading && !data ? (
        <p role="status" className="nb-compact text-muted-foreground">
          Loading file upload permissions…
        </p>
      ) : null}
      {!members.length && !isLoading ? (
        <p role="status" className="nb-compact text-muted-foreground">
          No members match these filters.
        </p>
      ) : null}
      <div className="divide-y divide-border">
        {members.map((member) => {
          const displayName = getProjectMemberDisplayName(member);
          const saving = savingMemberId === member.id;
          return (
            <div
              key={member.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar
                  identity={{
                    id: member.id,
                    fullName: displayName,
                    username: member.username ?? null,
                    avatarUrl: member.avatarUrl,
                  }}
                  size={36}
                  roundedClassName="rounded-[5px]"
                />
                <div className="min-w-0">
                  <p className="nb-ui-label break-words text-foreground">
                    {displayName}
                  </p>
                  <p className="nb-compact text-muted-foreground">
                    {getProjectMemberRoleLabel(
                      member.membershipRole ?? "member",
                    )}
                    {member.projectRoleTitle
                      ? ` · ${member.projectRoleTitle}`
                      : ""}
                  </p>
                  {member.username ? (
                    <p className="nb-meta break-all text-muted-foreground">
                      @{member.username}
                    </p>
                  ) : null}
                  <p className="nb-meta text-muted-foreground">
                    {formatJoinedAt(member.joinedAt)}
                  </p>
                </div>
              </div>
              {member.uploadPermissionLocked ? (
                <span className="nb-meta flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden="true" />
                  {member.uploadPermissionLabel}
                </span>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  {saving ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-label="Saving permission"
                    />
                  ) : null}
                  <SettingsSwitch
                    checked={member.fileUploadEnabled}
                    disabled={disabled}
                    showLabel
                    aria-label={`Allow file uploads for ${displayName}`}
                    onCheckedChange={(enabled) =>
                      void onToggle(member, enabled)
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data?.hasMore ? (
        <Button
          type="button"
          variant="outline"
          onClick={onLoadMore}
          disabled={disabled}
        >
          {loadingMore ? "Loading…" : "Load more members"}
        </Button>
      ) : null}
      <details className="border-t border-border pt-4">
        <summary className="nb-compact cursor-pointer">
          File permission rules
        </summary>
        <ul className="nb-compact mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
          {filePolicy.enforcedRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
      <ConfirmDialog
        open={bulkChoice !== null}
        onOpenChange={(open) => {
          if (!open && !bulkSaving) setBulkChoice(null);
        }}
        title={
          bulkChoice
            ? "Enable uploads for all members?"
            : "Disable uploads for all members?"
        }
        description={`Applies to all ${totalMembers} project members, including people outside the current filter or loaded pages, and changes the default for future members. Leaders remain enabled and viewers remain read-only.`}
        confirmLabel={bulkChoice ? "Enable all members" : "Disable all members"}
        variant={bulkChoice ? "default" : "destructive"}
        loading={bulkSaving}
        onConfirm={async () => {
          if (bulkChoice === null) return;
          if ((await onBulkToggle(bulkChoice)) === false)
            throw new Error(
              "Unable to update member permissions. Your previous settings are retained. Retry.",
            );
          setBulkChoice(null);
        }}
      />
    </div>
  );
}
