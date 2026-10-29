"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { Eye, Plus, Trash2, UserCog, UserPlus } from "lucide-react";
import type { ProjectRoleFormValue } from "@/lib/projects/project-roles-form";
import type { ProjectSettingsMember } from "@/lib/projects/settings-policies";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";

type ProjectRoleField = ProjectRoleFormValue & {
    fieldKey?: string;
};

type ProjectRolesEditorProps = {
    fields: ProjectRoleField[];
    register: UseFormRegister<any>;
    control: Control<any>;
    errors?: FieldErrors<any>;
    disabled?: boolean;
    className?: string;
    onAddRole: () => void;
    onRemoveRole: (index: number, roleId?: string) => void;
    members?: ProjectSettingsMember[];
    /** Pending and accepted applications per role id; a role with some asks before it is deleted. */
    applicationCounts?: Record<string, { pending: number; accepted: number }>;
};

type OccupiedEntry = {
    roleId: string;
    roleIndex: number;
    member: ProjectSettingsMember;
    field: ProjectRoleField;
    isLead: boolean;
};

type OpenEntry = {
    roleId: string;
    roleIndex: number;
    field: ProjectRoleField;
    openCount: number;
    isLead: boolean;
};

type SelectedTarget =
    | { type: "occupied"; roleIndex: number; roleId: string; memberId: string }
    | { type: "open"; roleIndex: number; roleId: string };

export function ProjectRolesEditor({
    fields,
    register,
    control,
    errors,
    disabled = false,
    className = "",
    onAddRole,
    onRemoveRole,
    members,
    applicationCounts,
}: ProjectRolesEditorProps) {
    const roleErrors = errors?.roles as
        | Array<{
            role?: { message?: string };
            count?: { message?: string };
            description?: { message?: string };
        }>
        | undefined;

    // Partition fields into occupied roles and open positions
    const { occupiedEntries, openEntries } = useMemo(() => {
        const occupied: OccupiedEntry[] = [];
        const open: OpenEntry[] = [];
        const assignedMemberIds = new Set<string>();

        fields.forEach((field, index) => {
            const roleId = field.id ?? `role-${index}`;
            const isLead = field.id === "lead-role";

            // Find assigned members for this role (ponytail: 1 member = 1 seat, never duplicate)
            const assignedMembers = members && members.length > 0
                ? members.filter((m) => {
                    if (assignedMemberIds.has(m.id)) return false;
                    if (isLead) {
                        return m.membershipRole === "owner";
                    }
                    return m.projectRoleTitle?.trim().toLowerCase() === field.role?.trim().toLowerCase();
                })
                : [];

            // Add each assigned member as an occupied entry
            assignedMembers.forEach((member) => {
                assignedMemberIds.add(member.id);
                occupied.push({
                    roleId,
                    roleIndex: index,
                    member,
                    field,
                    isLead,
                });
            });

            // Calculate remaining open capacity
            const targetCount = Math.max(1, field.count || 1);
            const openCount = targetCount - assignedMembers.length;

            if (openCount > 0) {
                open.push({
                    roleId,
                    roleIndex: index,
                    field,
                    openCount,
                    isLead,
                });
            } else if (assignedMembers.length === 0) {
                open.push({
                    roleId,
                    roleIndex: index,
                    field,
                    openCount: targetCount,
                    isLead,
                });
            }
        });

        return { occupiedEntries: occupied, openEntries: open };
    }, [fields, members]);

    const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);

    // Synchronize selected target whenever fields or entries change
    useEffect(() => {
        if (fields.length === 0) {
            setSelectedTarget(null);
            return;
        }

        const isValidOccupied =
            selectedTarget?.type === "occupied" &&
            selectedTarget.roleIndex < fields.length &&
            occupiedEntries.some(
                (e) => e.roleIndex === selectedTarget.roleIndex && e.member.id === selectedTarget.memberId
            );

        const isValidOpen =
            selectedTarget?.type === "open" &&
            selectedTarget.roleIndex < fields.length &&
            openEntries.some((e) => e.roleIndex === selectedTarget.roleIndex);

        if (!isValidOccupied && !isValidOpen) {
            const firstOccupied = occupiedEntries[0];
            const firstOpen = openEntries[0];
            if (firstOccupied) {
                setSelectedTarget({
                    type: "occupied",
                    roleIndex: firstOccupied.roleIndex,
                    roleId: firstOccupied.roleId,
                    memberId: firstOccupied.member.id,
                });
            } else if (firstOpen) {
                setSelectedTarget({
                    type: "open",
                    roleIndex: firstOpen.roleIndex,
                    roleId: firstOpen.roleId,
                });
            } else {
                setSelectedTarget({
                    type: "open",
                    roleIndex: 0,
                    roleId: fields[0]?.id ?? "role-0",
                });
            }
        }
    }, [fields, occupiedEntries, openEntries, selectedTarget]);

    const handleAddRoleAndSelect = () => {
        const nextIndex = fields.length;
        onAddRole();
        setSelectedTarget({
            type: "open",
            roleIndex: nextIndex,
            roleId: `new-role-${nextIndex}`,
        });
    };

    // A role people have applied to asks first: its pending applications stay in the queue, but can only be declined.
    const [removal, setRemoval] = useState<{ index: number; roleId: string; name: string } | null>(null);
    const removalCounts = removal ? applicationCounts?.[removal.roleId] : undefined;
    const handleRemoveRoleAndSelect = (index: number, roleId?: string) => {
        const counts = roleId ? applicationCounts?.[roleId] : undefined;
        if (roleId && counts && (counts.pending > 0 || counts.accepted > 0)) {
            setRemoval({ index, roleId, name: fields[index]?.role || "this role" });
            return;
        }
        onRemoveRole(index, roleId);
        setSelectedTarget(null);
    };

    if (fields.length === 0) {
        return (
            <div className={`space-y-6 ${className}`}>
                <div className="nb-empty-state flex flex-col items-center justify-center py-8 text-center">
                    <UserCog className="h-8 w-8 text-muted-foreground/70 mb-2.5" />
                    <p className="nb-card-title text-foreground">No roles configured</p>
                    <p className="nb-compact mt-1 text-xs text-muted-foreground">
                        Add roles to show what you’re looking for and invite people.
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddRoleAndSelect}
                        disabled={disabled}
                        className="nb-touch-target mt-4 h-[34px] gap-1.5 rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Position
                    </Button>
                </div>
            </div>
        );
    }

    const activeIndex = selectedTarget ? Math.min(selectedTarget.roleIndex, fields.length - 1) : 0;
    const activeField = fields[activeIndex];
    const isLeadRole = activeField?.id === "lead-role";

    const selectedOccupant = selectedTarget?.type === "occupied"
        ? occupiedEntries.find((e) => e.roleIndex === activeIndex && e.member.id === selectedTarget.memberId)?.member
        : null;
    const activeTotalSeats = Math.max(1, activeField?.count || 1);
    const activeOccupiedCount = occupiedEntries.filter((e) => e.roleIndex === activeIndex).length;
    const activeRemainingOpenCount = Math.max(0, activeTotalSeats - activeOccupiedCount);
    const activeOpenCount = selectedTarget?.type === "open"
        ? (openEntries.find((e) => e.roleIndex === activeIndex)?.openCount ?? activeRemainingOpenCount)
        : activeRemainingOpenCount;

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Single Row Ribbon Section */}
            <div className="space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                    <div className="space-y-0.5">
                        <h3 className="nb-card-title text-base font-semibold text-foreground">Project Roles and Team Assignments</h3>
                        <p className="nb-compact text-xs text-muted-foreground">
                            All roles in a single row · {occupiedEntries.length} occupied {occupiedEntries.length === 1 ? "seat" : "seats"} · {openEntries.length} open {openEntries.length === 1 ? "position" : "positions"}
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddRoleAndSelect}
                        disabled={disabled}
                        className="nb-touch-target h-[34px] gap-1.5 rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted shrink-0"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Position
                    </Button>
                </div>

                {/* Single Row Horizontal Track */}
                <div className="flex items-center gap-3.5 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar [scrollbar-width:none]">
                    {/* OCCUPIED ROLES SECTION */}
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 pr-1">
                            <span className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Occupied ({occupiedEntries.length})
                            </span>
                        </div>
                        {occupiedEntries.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic px-2">None</span>
                        ) : (
                            occupiedEntries.map((entry) => {
                                const isSelected =
                                    selectedTarget?.type === "occupied" &&
                                    selectedTarget.roleIndex === entry.roleIndex &&
                                    selectedTarget.memberId === entry.member.id;

                                return (
                                    <button
                                        key={`occupied-${entry.roleId}-${entry.member.id}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={isSelected}
                                        onClick={() =>
                                            setSelectedTarget({
                                                type: "occupied",
                                                roleIndex: entry.roleIndex,
                                                roleId: entry.roleId,
                                                memberId: entry.member.id,
                                            })
                                        }
                                        className={cn(
                                            "group flex items-center gap-2.5 rounded-[5px] border px-3 py-2 text-left text-xs transition-all duration-150 shrink-0 cursor-pointer outline-none min-h-[42px]",
                                            isSelected
                                                ? "border-foreground/80 bg-accent/40 text-foreground ring-1 ring-foreground/20 shadow-xs"
                                                : "border-border bg-background hover:bg-muted/30 hover:border-foreground/20 text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <UserAvatar
                                            identity={{
                                                id: entry.member.id,
                                                fullName: entry.member.fullName,
                                                username: entry.member.username,
                                                avatarUrl: entry.member.avatarUrl,
                                            }}
                                            size={24}
                                            roundedClassName="rounded-[5px]"
                                        />
                                        <div className="flex flex-col min-w-0 pr-1">
                                            <span className="font-semibold text-foreground text-xs leading-tight truncate max-w-[120px]">
                                                {entry.member.fullName || entry.member.username}
                                            </span>
                                            <span className="text-[10px] max-md:text-[11px] text-muted-foreground leading-tight truncate max-w-[120px]">
                                                {entry.field.role || "Owner"}
                                            </span>
                                        </div>
                                        <span
                                            className={cn(
                                                "inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none border shrink-0",
                                                entry.member.membershipRole === "owner"
                                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                                    : entry.member.membershipRole === "admin"
                                                        ? "bg-primary/10 text-primary border-primary/20"
                                                        : "bg-muted text-muted-foreground border-border"
                                            )}
                                        >
                                            {entry.member.membershipRole === "owner"
                                                ? "Owner"
                                                : entry.member.membershipRole === "admin"
                                                    ? "Admin"
                                                    : "Member"}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* VERTICAL DIVIDER */}
                    <div className="h-7 w-px bg-border shrink-0 self-center" aria-hidden="true" />

                    {/* OPEN POSITIONS SECTION */}
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 pr-1">
                            <span className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Open ({openEntries.length})
                            </span>
                        </div>
                        {openEntries.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic px-2">None</span>
                        ) : (
                            openEntries.map((entry) => {
                                const isSelected =
                                    selectedTarget?.type === "open" && selectedTarget.roleIndex === entry.roleIndex;

                                return (
                                    <button
                                        key={`open-${entry.roleId}-${entry.roleIndex}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={isSelected}
                                        onClick={() =>
                                            setSelectedTarget({
                                                type: "open",
                                                roleIndex: entry.roleIndex,
                                                roleId: entry.roleId,
                                            })
                                        }
                                        className={cn(
                                            "group flex items-center gap-2.5 rounded-[5px] border px-3 py-2 text-left text-xs transition-all duration-150 shrink-0 cursor-pointer outline-none min-h-[42px]",
                                            isSelected
                                                ? "border-foreground/80 bg-accent/40 text-foreground ring-1 ring-foreground/20 shadow-xs"
                                                : "border-border bg-background hover:bg-muted/30 hover:border-foreground/20 text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <div className="flex size-6 items-center justify-center rounded-[5px] border border-dashed border-border bg-muted/30 text-muted-foreground shrink-0">
                                            <UserPlus className="h-3 w-3" />
                                        </div>
                                        <div className="flex flex-col min-w-0 pr-1">
                                            <span className="font-semibold text-foreground text-xs leading-tight truncate max-w-[120px]">
                                                {entry.field.role || "Untitled Role"}
                                            </span>
                                            <span className="text-[10px] max-md:text-[11px] text-muted-foreground leading-tight">
                                                {entry.openCount === 1 ? "1 open spot" : `${entry.openCount} open spots`}
                                                {applicationCounts?.[entry.roleId]?.pending ? ` · ${applicationCounts[entry.roleId]!.pending} pending` : ""}
                                            </span>
                                        </div>
                                        <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] border border-dashed border-border bg-muted/20 text-muted-foreground font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0">
                                            Open
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Master-Detail Inspector / Workspace */}
            {activeField ? (
                selectedTarget?.type === "occupied" && selectedOccupant ? (
                    /* CASE A: OCCUPIED ROLE & OCCUPANT PROFILE INSPECTOR */
                    <div className="border-t border-border pt-6 grid gap-6 lg:grid-cols-12 transition-colors">
                        {/* Occupant Profile Column */}
                        <div className="lg:col-span-4 space-y-4 border-b lg:border-b-0 lg:border-r border-border pb-5 lg:pb-0 lg:pr-5">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <span>Occupant Profile</span>
                            </div>
                            <div className="flex items-start gap-3.5">
                                <UserAvatar
                                    identity={{
                                        id: selectedOccupant.id,
                                        fullName: selectedOccupant.fullName,
                                        username: selectedOccupant.username,
                                        avatarUrl: selectedOccupant.avatarUrl,
                                    }}
                                    size={52}
                                    roundedClassName="rounded-md"
                                />
                                <div className="flex flex-col min-w-0">
                                    <h4 className="nb-card-title text-foreground break-words">
                                        {selectedOccupant.fullName || selectedOccupant.username || "Team Member"}
                                    </h4>
                                    {selectedOccupant.username ? (
                                        <p className="nb-compact text-muted-foreground break-words">
                                            @{selectedOccupant.username}
                                        </p>
                                    ) : null}
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                        <span
                                            className={cn(
                                                "inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none border shrink-0",
                                                selectedOccupant.membershipRole === "owner"
                                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                                    : selectedOccupant.membershipRole === "admin"
                                                        ? "bg-primary/10 text-primary border-primary/20"
                                                        : "bg-muted text-muted-foreground border-border"
                                            )}
                                        >
                                            {selectedOccupant.membershipRole === "owner"
                                                ? "Owner"
                                                : selectedOccupant.membershipRole === "admin"
                                                    ? "Admin"
                                                    : "Member"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Profile metadata */}
                            <div className="space-y-2 pt-2 text-xs">
                                {selectedOccupant.joinedAt ? (
                                    <div className="flex items-center justify-between text-muted-foreground">
                                        <span className="nb-meta text-[11px]">Joined project</span>
                                        <span className="nb-meta text-[11px] text-foreground font-medium">
                                            {new Date(selectedOccupant.joinedAt).toLocaleDateString(undefined, {
                                                month: "short",
                                                day: "numeric",
                                                year: "numeric",
                                            })}
                                        </span>
                                    </div>
                                ) : null}
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="nb-meta text-[11px]">Assigned Role</span>
                                    <span className="nb-meta text-[11px] text-foreground font-medium truncate max-w-[160px]">
                                        {activeField.role || "Owner"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="nb-meta text-[11px]">Seat Allocation</span>
                                    <span className="nb-meta text-[11px] text-foreground font-medium">
                                        {isLeadRole
                                            ? "1 occupied (Fixed)"
                                            : `${activeOccupiedCount} occupied · ${activeRemainingOpenCount} open`}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Role Specifications Form Column */}
                        <div className="lg:col-span-8 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-0.5">
                                    <h4 className="nb-card-title text-sm font-semibold text-foreground">Role Specifications</h4>
                                    <p className="nb-compact text-xs text-muted-foreground">
                                        Configure title, responsibilities, and skill stack for this occupied role.
                                    </p>
                                </div>
                                {isLeadRole ? (
                                    <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                        Lead Role · Fixed (1 Seat)
                                    </span>
                                ) : (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.09em] leading-none bg-primary/10 text-primary border border-primary/20">
                                            {activeOccupiedCount} occupied {activeOccupiedCount === 1 ? "seat" : "seats"}
                                        </span>
                                        <span className={cn(
                                            "inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.09em] leading-none border",
                                            activeRemainingOpenCount > 0
                                                ? "bg-muted text-muted-foreground border-border"
                                                : "bg-muted/40 text-muted-foreground/60 border-border/60"
                                        )}>
                                            {activeRemainingOpenCount} open {activeRemainingOpenCount === 1 ? "seat" : "seats"}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="grid gap-4 sm:grid-cols-12">
                                <div className={cn(isLeadRole ? "sm:col-span-12" : "sm:col-span-9", "space-y-1.5")}>
                                    <label className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Role Title
                                    </label>
                                    <input
                                        {...register(`roles.${activeIndex}.role`)}
                                        disabled={disabled}
                                        placeholder="e.g. Frontend Lead"
                                        className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                    {roleErrors?.[activeIndex]?.role?.message ? (
                                        <p className="text-xs text-destructive">{roleErrors[activeIndex]?.role?.message}</p>
                                    ) : null}
                                </div>
                                {!isLeadRole ? (
                                    <div className="sm:col-span-3 space-y-1.5">
                                        <label className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            Total Seats
                                        </label>
                                        <input
                                            type="number"
                                            min={Math.max(1, activeOccupiedCount)}
                                            {...register(`roles.${activeIndex}.count`, { valueAsNumber: true })}
                                            disabled={disabled}
                                            className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60"
                                        />
                                        <p className="nb-compact text-[11px] text-muted-foreground leading-tight">
                                            {activeOccupiedCount} occupied {activeOccupiedCount === 1 ? "seat" : "seats"} · {activeRemainingOpenCount} open {activeRemainingOpenCount === 1 ? "seat" : "seats"}
                                        </p>
                                        {roleErrors?.[activeIndex]?.count?.message ? (
                                            <p className="text-xs text-destructive">{roleErrors[activeIndex]?.count?.message}</p>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>

                            <div className="space-y-1.5">
                                <label className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Role Description and Responsibilities
                                </label>
                                <textarea
                                    {...register(`roles.${activeIndex}.description`)}
                                    disabled={disabled}
                                    placeholder="Describe responsibilities and requirements for this role…"
                                    className="min-h-[80px] w-full rounded-[5px] border border-border bg-background px-3 py-2.5 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 resize-y"
                                />
                            </div>

                            <div>
                                <Controller
                                    control={control}
                                    name={`roles.${activeIndex}.skills`}
                                    render={({ field: skillsField }) => (
                                        <SkillPicker
                                            value={Array.isArray(skillsField.value) ? skillsField.value : []}
                                            onChange={skillsField.onChange}
                                            maxSkills={12}
                                            label="Required and preferred skills"
                                            description="These skills power role matching and application recommendations."
                                            compact
                                        />
                                    )}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    /* CASE B: OPEN POSITION EDITOR & APPLICANT VIEW PREVIEW */
                    <div className="border-t border-border pt-6 grid gap-6 lg:grid-cols-12 transition-colors">
                        {/* Open Role Configuration Form Column */}
                        <div className="lg:col-span-8 space-y-4">
                            <div className="flex items-center justify-between gap-4">
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                        <h4 className="nb-card-title text-sm font-semibold text-foreground">Open Role Configuration</h4>
                                        <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] border border-dashed border-border bg-muted/20 text-muted-foreground font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none">
                                            Vacancy
                                        </span>
                                    </div>
                                    <p className="nb-compact text-xs text-muted-foreground">
                                        Define position title, headcount, responsibilities, and skill criteria for applicant matching.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!isLeadRole ? (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.09em] leading-none bg-primary/10 text-primary border border-primary/20">
                                                {activeOccupiedCount} occupied {activeOccupiedCount === 1 ? "seat" : "seats"}
                                            </span>
                                            <span className={cn(
                                                "inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.09em] leading-none border",
                                                activeRemainingOpenCount > 0
                                                    ? "bg-muted text-muted-foreground border-border"
                                                    : "bg-muted/40 text-muted-foreground/60 border-border/60"
                                            )}>
                                                {activeRemainingOpenCount} open {activeRemainingOpenCount === 1 ? "seat" : "seats"}
                                            </span>
                                        </div>
                                    ) : null}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        aria-label={`Remove role ${activeIndex + 1}`}
                                        onClick={() => handleRemoveRoleAndSelect(activeIndex, activeField.id)}
                                        disabled={disabled || isLeadRole}
                                        className="nb-touch-target h-[34px] gap-1.5 rounded-[5px] px-3 text-[13px] font-medium leading-[1.2] text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                                        style={isLeadRole ? { opacity: 0.3, cursor: "not-allowed" } : undefined}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete Position
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-12">
                                <div className="sm:col-span-9 space-y-1.5">
                                    <label className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Role Title
                                    </label>
                                    <input
                                        {...register(`roles.${activeIndex}.role`)}
                                        disabled={disabled}
                                        placeholder="e.g. Frontend Developer"
                                        className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                    {roleErrors?.[activeIndex]?.role?.message ? (
                                        <p className="text-xs text-destructive">{roleErrors[activeIndex]?.role?.message}</p>
                                    ) : null}
                                </div>
                                <div className="sm:col-span-3 space-y-1.5">
                                    <label className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Total Seats
                                    </label>
                                    <input
                                        type="number"
                                        min={Math.max(1, activeOccupiedCount)}
                                        {...register(`roles.${activeIndex}.count`, { valueAsNumber: true })}
                                        disabled={disabled || isLeadRole}
                                        className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                    <p className="nb-compact text-[11px] text-muted-foreground leading-tight">
                                        {activeOccupiedCount} occupied {activeOccupiedCount === 1 ? "seat" : "seats"} · {activeRemainingOpenCount} open {activeRemainingOpenCount === 1 ? "seat" : "seats"}
                                    </p>
                                    {roleErrors?.[activeIndex]?.count?.message ? (
                                        <p className="text-xs text-destructive">{roleErrors[activeIndex]?.count?.message}</p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Role Description and Responsibilities
                                </label>
                                <textarea
                                    {...register(`roles.${activeIndex}.description`)}
                                    disabled={disabled}
                                    placeholder="Describe the responsibilities, expected impact, and requirements for this position…"
                                    className="min-h-[80px] w-full rounded-[5px] border border-border bg-background px-3 py-2.5 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-60 resize-y"
                                />
                            </div>

                            <div>
                                <Controller
                                    control={control}
                                    name={`roles.${activeIndex}.skills`}
                                    render={({ field: skillsField }) => (
                                        <SkillPicker
                                            value={Array.isArray(skillsField.value) ? skillsField.value : []}
                                            onChange={skillsField.onChange}
                                            maxSkills={12}
                                            label="Required and preferred skills"
                                            description="These skills power role matching and application recommendations."
                                            compact
                                        />
                                    )}
                                />
                            </div>
                        </div>

                        {/* Live Applicant View Preview Column */}
                        <div className="lg:col-span-4 space-y-4 border-t lg:border-t-0 lg:border-l border-border pt-5 lg:pt-0 lg:pl-5">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Eye className="h-3.5 w-3.5 text-primary" />
                                <span>Applicant View Preview</span>
                            </div>
                            <p className="nb-compact text-xs text-muted-foreground">
                                Preview how candidates see this vacancy on the public project page.
                            </p>
                            <div className="border-t border-border pt-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <h5 className="font-semibold text-sm text-foreground">
                                            {activeField.role || "Untitled Position"}
                                        </h5>
                                        <span className="nb-meta text-[11px] text-muted-foreground">
                                            {activeOpenCount === 1 ? "1 spot available" : `${activeOpenCount} spots available`}
                                        </span>
                                    </div>
                                    <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none bg-primary/10 text-primary border border-primary/20">
                                        Open
                                    </span>
                                </div>
                                {activeField.description ? (
                                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                                        {activeField.description}
                                    </p>
                                ) : (
                                    <p className="text-xs text-muted-foreground/60 italic">
                                        No description provided yet.
                                    </p>
                                )}
                                {Array.isArray(activeField.skills) && activeField.skills.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                        {activeField.skills.slice(0, 4).map((sk) => (
                                            <span key={sk} className="inline-flex items-center rounded-[3px] px-1.5 py-0.5 bg-background border border-border text-foreground font-mono text-[10px] max-md:text-[11px]">
                                                {sk}
                                            </span>
                                        ))}
                                        {activeField.skills.length > 4 ? (
                                            <span className="text-[10px] max-md:text-[11px] text-muted-foreground self-center font-mono">
                                                +{activeField.skills.length - 4} more
                                            </span>
                                        ) : null}
                                    </div>
                                ) : null}
                                <div className="pt-2 border-t border-border/60">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled
                                        className="nb-touch-target h-[34px] w-full rounded-[5px] text-[13px] font-medium leading-[1.2] opacity-70 cursor-default"
                                    >
                                        Apply for this role
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            ) : null}
            <ConfirmDialog
                open={removal !== null}
                onOpenChange={(open) => { if (!open) setRemoval(null); }}
                title={`Remove ${removal?.name ?? "this role"}?`}
                description={[
                    removalCounts?.pending ? `${removalCounts.pending} pending ${removalCounts.pending === 1 ? "application stays" : "applications stay"} in your queue, and can then only be declined.` : null,
                    removalCounts?.accepted ? `${removalCounts.accepted} accepted ${removalCounts.accepted === 1 ? "member keeps" : "members keep"} their place on the project.` : null,
                    "The role is removed when you save.",
                ].filter(Boolean).join(" ")}
                confirmLabel="Remove role"
                variant="destructive"
                onConfirm={() => {
                    if (removal) {
                        onRemoveRole(removal.index, removal.roleId);
                        setSelectedTarget(null);
                    }
                    setRemoval(null);
                }}
            />
        </div>
    );
}
