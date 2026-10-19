'use client';

import { useMemo, useState } from "react";
import {
    Check,
    ChevronDown,
    Loader2,
    Lock,
    Search,
    Shield,
    Upload,
    Users,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    buildProjectFilePolicy,
    getProjectMemberDisplayName,
    getProjectMemberRoleLabel,
    type ProjectMemberRole,
    type ProjectSettingsMember,
} from "@/lib/projects/settings-policies";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

export type FileWorkspaceSettingsData = {
    members: Array<ProjectSettingsMember & {
        fileUploadEnabled: boolean;
        uploadPermissionLocked: boolean;
        uploadPermissionLabel: string;
    }>;
    summary: {
        alwaysAllowedCount: number;
        enabledMemberCount: number;
        disabledMemberCount: number;
    };
    /** The server lists the first members only; the summary above still covers everyone. */
    hasMore?: boolean;
};

export function formatJoinedAt(value?: string | null) {
    if (!value) return "Joined date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Joined date unavailable";
    return `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

export function FileWorkspaceMembers({
    data,
    isLoading,
    savingMemberId,
    bulkSaving,
    onToggle,
    onBulkToggle,
    filePolicy,
}: {
    data: FileWorkspaceSettingsData | null;
    isLoading: boolean;
    savingMemberId: string | null;
    bulkSaving: boolean;
    onToggle: (member: FileWorkspaceSettingsData["members"][number], enabled: boolean) => void | Promise<void>;
    onBulkToggle: (enabled: boolean) => void | Promise<void>;
    filePolicy: ReturnType<typeof buildProjectFilePolicy>;
}) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<"all" | "enabled" | "disabled">("all");

    const members = useMemo(() => data?.members ?? [], [data?.members]);

    // Partition into Leadership vs Team Members
    const leaders = useMemo(
        () => members.filter((m) => m.membershipRole === "owner" || m.membershipRole === "admin"),
        [members],
    );
    const standardMembers = useMemo(
        () => members.filter((m) => m.membershipRole !== "owner" && m.membershipRole !== "admin"),
        [members],
    );

    const filteredLeaders = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return leaders;
        return leaders.filter((member) => {
            const displayName = getProjectMemberDisplayName(member).toLowerCase();
            const username = (member.username ?? "").toLowerCase();
            const roleTitle = (member.projectRoleTitle ?? "").toLowerCase();
            const roleLabel = getProjectMemberRoleLabel(member.membershipRole as ProjectMemberRole).toLowerCase();
            return displayName.includes(query) || username.includes(query) || roleTitle.includes(query) || roleLabel.includes(query);
        });
    }, [leaders, searchQuery]);

    const filteredStandardMembers = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return standardMembers.filter((member) => {
            if (filterStatus === "enabled" && !member.fileUploadEnabled) return false;
            if (filterStatus === "disabled" && member.fileUploadEnabled) return false;
            if (!query) return true;
            const displayName = getProjectMemberDisplayName(member).toLowerCase();
            const username = (member.username ?? "").toLowerCase();
            const roleTitle = (member.projectRoleTitle ?? "").toLowerCase();
            const roleLabel = getProjectMemberRoleLabel(member.membershipRole as ProjectMemberRole).toLowerCase();
            return displayName.includes(query) || username.includes(query) || roleTitle.includes(query) || roleLabel.includes(query);
        });
    }, [standardMembers, searchQuery, filterStatus]);

    const enabledStandardCount = useMemo(
        () => standardMembers.filter((m) => m.fileUploadEnabled).length,
        [standardMembers],
    );
    const disabledStandardCount = useMemo(
        () => standardMembers.filter((m) => !m.fileUploadEnabled).length,
        [standardMembers],
    );

    if (isLoading && !data) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Loading file upload permissions...
            </div>
        );
    }

    if (members.length === 0) {
        return <p className="text-sm text-muted-foreground">No project members found.</p>;
    }

    return (
        <div className="space-y-6">
            {data?.hasMore ? (
                <p className="nb-meta text-xs text-muted-foreground" role="status">
                    Showing the first {members.length} members. Totals include everyone on the project.
                </p>
            ) : null}
            {/* Section 1: Project Leadership (Enforced Invariant) */}
            <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                        <Shield className="size-4 text-primary" />
                        <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Project Leadership
                        </span>
                    </div>
                    <span className="nb-meta text-xs text-muted-foreground">
                        {leaders.length} {leaders.length === 1 ? "leader" : "leaders"} · Intake always active
                    </span>
                </div>

                {filteredLeaders.length === 0 && searchQuery.trim() ? (
                    <div className="rounded-lg border border-dashed border-border bg-card nb-grid-ground p-4 text-center text-xs text-muted-foreground" role="status">
                        No leaders match &ldquo;{searchQuery}&rdquo;.
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {filteredLeaders.map((member) => {
                            const role = member.membershipRole as ProjectMemberRole;
                            const displayName = getProjectMemberDisplayName(member);
                            const roleTitle = member.projectRoleTitle?.trim();
                            const username = member.username?.trim();

                            return (
                                <div
                                    key={member.id}
                                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <UserAvatar
                                            identity={{
                                                id: member.id,
                                                fullName: displayName,
                                                username: member.username ?? null,
                                                avatarUrl: member.avatarUrl,
                                            }}
                                            size={44}
                                            roundedClassName="rounded-[5px]"
                                            className="border border-border shrink-0"
                                        />
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="nb-ui-label truncate text-sm font-semibold text-foreground">
                                                    {displayName}
                                                </p>
                                                <span
                                                    className={cn(
                                                        "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border",
                                                        role === "owner"
                                                            ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                                            : "border-primary/20 bg-primary/10 text-primary",
                                                    )}
                                                >
                                                    {getProjectMemberRoleLabel(role)}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                                {roleTitle ? (
                                                    <span className="nb-compact font-medium text-foreground">{roleTitle}</span>
                                                ) : null}
                                                {roleTitle && username ? (
                                                    <span className="text-muted-foreground/60">·</span>
                                                ) : null}
                                                {username ? (
                                                    <span className="nb-compact text-muted-foreground">@{username}</span>
                                                ) : null}
                                            </div>
                                            <p className="nb-meta mt-0.5 text-[11px] text-muted-foreground/80">
                                                {formatJoinedAt(member.joinedAt)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-border bg-muted/50 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-foreground">
                                            <Shield className="size-3 text-primary shrink-0" />
                                            Always active · Lead policy
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Section 2: Team Member Intake Permissions */}
            <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                        <Users className="size-4 text-muted-foreground" />
                        <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Team Member Intake
                        </span>
                    </div>
                    <span className="nb-meta text-xs text-muted-foreground">
                        {standardMembers.length} {standardMembers.length === 1 ? "member" : "members"} · {enabledStandardCount} allowed
                    </span>
                </div>

                {/* Toolbar: Search input + Filter tabs + Bulk Actions dropdown */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative min-w-[200px] max-w-sm flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search members by name or role..."
                            aria-label="Search members by name or role"
                            className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div
                            className="flex items-center gap-1 rounded-[5px] border border-border bg-muted/20 p-0.5"
                            role="tablist"
                            aria-label="Filter members by upload status"
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filterStatus === "all"}
                                onClick={() => setFilterStatus("all")}
                                className={cn(
                                    "nb-touch-target h-[28px] rounded-[3px] px-2.5 text-[12px] font-medium transition-colors",
                                    filterStatus === "all"
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                            >
                                All ({standardMembers.length})
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filterStatus === "enabled"}
                                onClick={() => setFilterStatus("enabled")}
                                className={cn(
                                    "nb-touch-target h-[28px] rounded-[3px] px-2.5 text-[12px] font-medium transition-colors",
                                    filterStatus === "enabled"
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                            >
                                Allowed ({enabledStandardCount})
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filterStatus === "disabled"}
                                onClick={() => setFilterStatus("disabled")}
                                className={cn(
                                    "nb-touch-target h-[28px] rounded-[3px] px-2.5 text-[12px] font-medium transition-colors",
                                    filterStatus === "disabled"
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                            >
                                Paused ({disabledStandardCount})
                            </button>
                        </div>

                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={bulkSaving || standardMembers.length === 0}
                                    className="nb-touch-target h-[34px] gap-1.5 rounded-[5px] border-border px-3 text-[13px] font-medium text-foreground hover:bg-muted"
                                >
                                    {bulkSaving ? <Loader2 className="size-3.5 animate-spin text-primary" /> : null}
                                    Bulk actions
                                    <ChevronDown className="size-3.5 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem
                                    onClick={() => void onBulkToggle(true)}
                                    disabled={bulkSaving}
                                    className="gap-2 text-xs"
                                >
                                    <Check className="size-3.5 text-primary" />
                                    Enable all members
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => void onBulkToggle(false)}
                                    disabled={bulkSaving}
                                    className="gap-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <Lock className="size-3.5" />
                                    Disable all members
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {filteredStandardMembers.length === 0 ? (
                    <div className="nb-empty-state nb-grid-ground rounded-lg p-8 text-center text-sm text-muted-foreground">
                        {searchQuery ? `No members found matching “${searchQuery}”.` : "No members match the selected filter."}
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {filteredStandardMembers.map((member) => {
                            const role = member.membershipRole as ProjectMemberRole;
                            const displayName = getProjectMemberDisplayName(member);
                            const roleTitle = member.projectRoleTitle?.trim();
                            const username = member.username?.trim();
                            const isSaving = savingMemberId === member.id;

                            return (
                                <div
                                    key={member.id}
                                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <UserAvatar
                                            identity={{
                                                id: member.id,
                                                fullName: displayName,
                                                username: member.username ?? null,
                                                avatarUrl: member.avatarUrl,
                                            }}
                                            size={44}
                                            roundedClassName="rounded-[5px]"
                                            className="border border-border shrink-0"
                                        />
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="nb-ui-label truncate text-sm font-semibold text-foreground">
                                                    {displayName}
                                                </p>
                                                <span
                                                    className={cn(
                                                        "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border",
                                                        role === "viewer"
                                                            ? "border-border bg-muted/60 text-muted-foreground"
                                                            : "border-border bg-muted text-foreground",
                                                    )}
                                                >
                                                    {getProjectMemberRoleLabel(role)}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                                {roleTitle ? (
                                                    <span className="nb-compact font-medium text-foreground">{roleTitle}</span>
                                                ) : null}
                                                {roleTitle && username ? (
                                                    <span className="text-muted-foreground/60">·</span>
                                                ) : null}
                                                {username ? (
                                                    <span className="nb-compact text-muted-foreground">@{username}</span>
                                                ) : null}
                                            </div>
                                            <p className="nb-meta mt-0.5 text-[11px] text-muted-foreground/80">
                                                {formatJoinedAt(member.joinedAt)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-3">
                                        {member.uploadPermissionLocked ? (
                                            <span className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-border bg-muted/40 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                                                <Lock className="size-3 shrink-0" />
                                                Read-only
                                            </span>
                                        ) : (
                                             <div className="flex items-center gap-3">
                                                 <div className="hidden sm:block text-right">
                                                     <span className="block nb-ui-label text-xs font-semibold text-foreground">
                                                         {member.fileUploadEnabled ? "Upload allowed" : "Upload paused"}
                                                     </span>
                                                     <span className="block nb-meta text-[11px] text-muted-foreground">
                                                         {isSaving
                                                             ? "Updating permissions..."
                                                             : member.fileUploadEnabled
                                                                 ? "Full workspace intake"
                                                                 : "Read-only access"}
                                                     </span>
                                                 </div>
                                                 <div className="flex shrink-0 items-center gap-3">
                                                     <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                                                         {isSaving ? "..." : member.fileUploadEnabled ? "On" : "Off"}
                                                     </span>
                                                     {isSaving ? (
                                                         <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                                     ) : (
                                                         <SettingsSwitch
                                                             checked={member.fileUploadEnabled}
                                                             disabled={isSaving}
                                                             aria-label={`Toggle file uploads for ${displayName}`}
                                                             onCheckedChange={(next) => void onToggle(member, next)}
                                                         />
                                                     )}
                                                 </div>
                                             </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
