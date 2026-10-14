"use client";

import { memo, useMemo, useState } from "react";
import { Briefcase, CheckCircle, Clock, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import DashboardCard from "./DashboardCard";
import { SkillList } from "@/components/skills/SkillList";
import {
    experienceLevelLabel,
    rolePreferenceLabel,
    weeklyCapacityLabel,
} from "@/lib/profile/role-preferences";
import { type ApplicationStatusResult } from "@/app/actions/applications";

interface OpenRolesCardProps {
    roles: any[];
    isCreator: boolean;
    isCollaborator: boolean;
    applicationStatus: ApplicationStatusResult;
    onApply: (role?: any) => void;
    onManageRoles: () => void;
    onAcceptInvitation?: () => void;
    onDeclineInvitation?: () => void;
    invitationLoading?: boolean;
}

export const OpenRolesCard = memo(function OpenRolesCard({
    roles,
    isCreator,
    isCollaborator,
    applicationStatus,
    onApply,
    onManageRoles,
    onAcceptInvitation,
    onDeclineInvitation,
    invitationLoading = false,
}: OpenRolesCardProps) {
    const [showAllMobile, setShowAllMobile] = useState(false);
    const openRoles = useMemo(() => {
        return roles.filter((role: any) => {
            const remaining = (role?.count || 0) - (role?.filled || 0);
            return remaining > 0;
        });
    }, [roles]);

    const isProposed = applicationStatus.status === "proposed";
    const isGuidanceInvitation = isProposed && applicationStatus.invitationKind === "guidance_appointment";

    if (!isCreator && openRoles.length === 0 && !isGuidanceInvitation) return null;

    if (openRoles.length === 0 && !isGuidanceInvitation) {
        return (
            <DashboardCard title="Open roles" icon={Briefcase} compact id="open-roles" className="scroll-mt-28">
                <div className="space-y-3 py-1">
                    <p className="text-xs text-muted-foreground">No open roles defined yet.</p>
                    <button
                        type="button"
                        onClick={onManageRoles}
                        className="nb-touch-target inline-flex h-[34px] w-full items-center justify-center rounded-[5px] border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-[background-color,border-color,color] duration-[130ms] hover:bg-muted"
                    >
                        Add role
                    </button>
                </div>
            </DashboardCard>
        );
    }

    const isPending = applicationStatus.status === "pending";
    const isRejected = applicationStatus.status === "rejected";
    const invitationTitle = applicationStatus.proposedRoleTitle || applicationStatus.roleTitle || "Guide";
    const isRoleFilled = applicationStatus.lifecycleStatus === "role_filled" || applicationStatus.decisionReason === "role_filled";
    const canReapply = applicationStatus.canReapply ?? true;
    const isBlocked = isPending || isProposed || (isRejected && !canReapply);
    const waitTime = applicationStatus.waitTime;

    const blockedReason = isPending
        ? "You already have an application pending review."
        : isProposed
            ? `You have a pending ${invitationTitle} invitation. Review or decline it to apply for other roles.`
            : isRejected && !canReapply
                ? isRoleFilled
                    ? "This role has been filled."
                    : waitTime
                        ? `You can reapply in ${waitTime}.`
                        : "You cannot reapply yet."
                : null;

    const cannotReapplyLabel = isRejected && !canReapply
        ? isRoleFilled
            ? "Role filled"
            : waitTime
                ? `Cannot reapply • ${waitTime}`
                : "Cannot reapply"
        : null;
    const isApplyDisabled = isBlocked;
    const showMoreCount = openRoles.length - 10;

    return (
        <DashboardCard title="Open roles" icon={Briefcase} compact id="open-roles" className="scroll-mt-28">
            <div className="space-y-3">
                {blockedReason ? (
                    <p id="open-roles-apply-disabled-reason" className="px-1 text-[11px] text-muted-foreground">
                        {blockedReason}
                    </p>
                ) : null}

                {isCollaborator ? (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-[var(--status-success,#2F6B4F)]">
                        <CheckCircle className="h-3.5 w-3.5" />
                        <span>Team member</span>
                    </div>
                ) : isPending ? (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-[var(--status-warning,#9A6B00)]">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Application pending review</span>
                    </div>
                ) : isRejected && !canReapply ? (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-[var(--status-danger,#B3261E)]">
                        <XCircle className="h-3.5 w-3.5" />
                        <span>{cannotReapplyLabel || "Cannot reapply"}</span>
                    </div>
                ) : null}

                {isGuidanceInvitation ? (
                    <div className="flex w-full flex-col gap-2 rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-left">
                        <div className="min-w-0 flex-1">
                            <h4 className="text-[14px] font-semibold leading-snug text-foreground max-md:text-[17px]">
                                {invitationTitle}
                            </h4>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="nb-status shrink-0" data-status="draft">
                                    Invited
                                </span>
                                <span className="shrink-0 inline-flex items-center rounded-[3px] border border-border/70 bg-card/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] max-md:text-[11px] text-muted-foreground">
                                    Leadership
                                </span>
                            </div>
                        </div>
                        <p className="nb-compact text-[12px] leading-relaxed text-muted-foreground">
                            Leadership appointment for this project.
                        </p>
                        {!isCreator && !isCollaborator ? (
                            <div className="flex items-center justify-end gap-2 border-t border-[var(--status-warning)]/20 pt-2">
                                <button
                                    type="button"
                                    disabled={invitationLoading}
                                    onClick={() => onDeclineInvitation?.()}
                                    className="nb-touch-target inline-flex h-[28px] cursor-pointer items-center justify-center gap-1 rounded-[5px] border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
                                >
                                    Decline
                                </button>
                                <button
                                    type="button"
                                    disabled={invitationLoading}
                                    onClick={() => onAcceptInvitation?.()}
                                    className="nb-touch-target inline-flex h-[28px] cursor-pointer items-center justify-center gap-1 rounded-[5px] bg-[var(--status-success,#2F6B4F)] px-3 text-[12px] font-medium text-white shadow-none transition-colors hover:brightness-110 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {invitationLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                    Accept
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {openRoles.length > 0 ? (
                    <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1 max-md:max-h-none max-md:overflow-visible max-md:pr-0">
                        <div className="space-y-1">
                            {openRoles.slice(0, 10).map((role, roleIndex) => {
                                // Below md only the first three roles show until "Show all" (no nested scroller, R10).
                                const hiddenOnMobile = !showAllMobile && roleIndex >= 3;
                                const remaining = (role?.count || 0) - (role?.filled || 0);
                                const isInteractive = !isCreator && !isCollaborator;
                                const isThisProposedRole = isProposed && (role.id === applicationStatus.proposedRoleId || role.id === applicationStatus.roleId);
                                const isThisAppliedRole = isPending && role.id === applicationStatus.roleId;

                                if (isThisProposedRole) {
                                    return (
                                        <div
                                            key={role.id}
                                            className={cn("my-2 flex w-full flex-col gap-2 rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-left transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[180ms] first:mt-0 last:mb-0", hiddenOnMobile && "max-md:hidden")}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <h4 className="text-[14px] font-semibold leading-snug text-foreground max-md:text-[17px]">
                                                    {role.title ?? role.role}
                                                </h4>
                                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                    <span className="nb-status shrink-0" data-status="draft">
                                                        Invited
                                                    </span>
                                                    <span className="shrink-0 inline-flex items-center rounded-[3px] border border-border/70 bg-card/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] max-md:text-[11px] text-muted-foreground">
                                                        {remaining} {remaining === 1 ? "spot" : "spots"} left
                                                    </span>
                                                </div>
                                            </div>

                                            {(role.commitmentType || role.experienceRequired || role.hoursPerWeek) ? (
                                                <div className="nb-compact flex flex-wrap gap-x-1.5 gap-y-1 font-medium text-muted-foreground">
                                                    {role.commitmentType ? (
                                                        <span className="inline-flex items-center rounded-[3px] border border-border/60 bg-card/50 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                                                            {rolePreferenceLabel(role.commitmentType) || role.commitmentType}
                                                        </span>
                                                    ) : null}
                                                    {role.experienceRequired ? (
                                                        <span className="inline-flex items-center rounded-[3px] border border-border/60 bg-card/50 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                                                            {experienceLevelLabel(role.experienceRequired) || role.experienceRequired}
                                                        </span>
                                                    ) : null}
                                                    {role.hoursPerWeek ? (
                                                        <span className="inline-flex items-center rounded-[3px] border border-border/60 bg-card/50 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                                                            {weeklyCapacityLabel(role.hoursPerWeek) || role.hoursPerWeek}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}

                                            {role.description ? (
                                                <p className="nb-compact line-clamp-2 text-[12px] leading-relaxed text-muted-foreground max-md:text-[13px]">
                                                    {role.description}
                                                </p>
                                            ) : null}

                                            {role.skills?.length > 0 ? (
                                                <div className="mt-0.5">
                                                    <SkillList skills={role.skills} maxVisible={3} size="sm" />
                                                </div>
                                            ) : null}

                                            {!isCreator && !isCollaborator ? (
                                                <div className="flex items-center justify-end gap-2 border-t border-[var(--status-warning)]/20 pt-2">
                                                    <button
                                                        type="button"
                                                        disabled={invitationLoading}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            onDeclineInvitation?.();
                                                        }}
                                                        className="nb-touch-target inline-flex h-[28px] cursor-pointer items-center justify-center gap-1 rounded-[5px] border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
                                                    >
                                                        Decline
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={invitationLoading}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            onAcceptInvitation?.();
                                                        }}
                                                        className="nb-touch-target inline-flex h-[28px] cursor-pointer items-center justify-center gap-1 rounded-[5px] bg-[var(--status-success,#2F6B4F)] px-3 text-[12px] font-medium text-white shadow-none transition-colors hover:brightness-110 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
                                                    >
                                                        {invitationLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                                        Accept
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                }

                                const content = (
                                    <>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                <span className="text-[13.5px] font-semibold text-foreground transition-colors group-hover:text-primary max-md:text-[17px]">
                                                    {role.title ?? role.role}
                                                </span>
                                                {isThisAppliedRole ? (
                                                    <span className="nb-status shrink-0" data-status="draft">
                                                        Applied
                                                    </span>
                                                ) : null}
                                                <span className="shrink-0 inline-flex items-center rounded-[3px] border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] max-md:text-[11px] text-muted-foreground">
                                                    {remaining} {remaining === 1 ? "spot" : "spots"} left
                                                </span>
                                            </div>

                                            {(role.commitmentType || role.experienceRequired || role.hoursPerWeek) ? (
                                                <div className="nb-compact mt-1 flex flex-wrap gap-x-1.5 gap-y-1 font-medium text-muted-foreground">
                                                    {role.commitmentType ? (
                                                        <span className="inline-flex items-center rounded-[3px] border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                                                            {rolePreferenceLabel(role.commitmentType) || role.commitmentType}
                                                        </span>
                                                    ) : null}
                                                    {role.experienceRequired ? (
                                                        <span className="inline-flex items-center rounded-[3px] border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                                                            {experienceLevelLabel(role.experienceRequired) || role.experienceRequired}
                                                        </span>
                                                    ) : null}
                                                    {role.hoursPerWeek ? (
                                                        <span className="inline-flex items-center rounded-[3px] border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                                                            {weeklyCapacityLabel(role.hoursPerWeek) || role.hoursPerWeek}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}

                                            {role.description ? (
                                                <p className="nb-compact mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground max-md:text-[13px]">
                                                    {role.description}
                                                </p>
                                            ) : null}

                                            {role.skills?.length > 0 ? (
                                                <div className="mt-1.5">
                                                    <SkillList skills={role.skills} maxVisible={3} size="sm" />
                                                </div>
                                            ) : null}
                                        </div>

                                        {isInteractive ? (
                                            <div className="ml-2.5 flex shrink-0 items-center self-start pt-0.5">
                                                <span
                                                    className={cn(
                                                        "inline-flex h-[28px] items-center rounded-[5px] border px-2.5 text-[11px] font-semibold shadow-none transition-all",
                                                        isApplyDisabled
                                                            ? "border-border bg-muted text-muted-foreground"
                                                            : "border-transparent bg-primary text-primary-foreground hover:brightness-110",
                                                    )}
                                                >
                                                    {isThisAppliedRole ? "Pending" : isRejected && !canReapply ? (isRoleFilled ? "Filled" : "Rejected") : "Apply"}
                                                </span>
                                            </div>
                                        ) : null}
                                    </>
                                );
                                const isInteractiveRow = isInteractive;
                                const className = cn(
                                    "flex w-full items-start justify-between border-b border-border px-2 py-2.5 text-left last:border-b-0",
                                    hiddenOnMobile && "max-md:hidden",
                                    isInteractiveRow
                                        ? "group cursor-pointer rounded-[5px] transition-[background-color,color] duration-[130ms] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                                        : "",
                                );

                                return isInteractiveRow ? (
                                    <button
                                        key={role.id}
                                        type="button"
                                        onClick={() => onApply(role)}
                                        disabled={isApplyDisabled}
                                        aria-disabled={isApplyDisabled}
                                        aria-describedby={isApplyDisabled ? "open-roles-apply-disabled-reason" : undefined}
                                        title={isApplyDisabled ? (blockedReason || "Application is currently unavailable") : `Apply for ${role.title ?? role.role}`}
                                        className={className}
                                    >
                                        {content}
                                    </button>
                                ) : (
                                    <div key={role.id} className={className}>
                                        {content}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : null}

                {!showAllMobile && Math.min(openRoles.length, 10) > 3 ? (
                    <button
                        type="button"
                        onClick={() => setShowAllMobile(true)}
                        className="nb-touch-target nb-ui-label inline-flex w-full items-center justify-center text-primary md:hidden"
                    >
                        Show all {Math.min(openRoles.length, 10)} roles
                    </button>
                ) : null}

                {showMoreCount > 0 ? (
                    <div className="mt-1.5 flex justify-center border-t border-border pt-1.5">
                        {isCreator ? (
                            <button type="button" onClick={onManageRoles} className="nb-touch-target px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:underline">
                                + {showMoreCount} more {showMoreCount === 1 ? "role" : "roles"}
                            </button>
                        ) : (
                            <span className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                + {showMoreCount} more {showMoreCount === 1 ? "role" : "roles"}
                            </span>
                        )}
                    </div>
                ) : null}

                {isCreator ? (
                    <button
                        type="button"
                        onClick={onManageRoles}
                        className="nb-touch-target inline-flex h-[34px] w-full items-center justify-center rounded-[5px] border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-[background-color,border-color,color] duration-[130ms] hover:bg-muted"
                    >
                        Manage roles
                    </button>
                ) : null}
            </div>
        </DashboardCard>
    );
});

export default OpenRolesCard;
