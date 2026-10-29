"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    AlertTriangle,
    Archive,
    Crown,
    Trash2,
    Loader2,
} from "lucide-react";
import {
    type ProjectSettingsMember,
    getProjectMemberDisplayName,
    getProjectMemberRoleLabel,
} from "@/lib/projects/settings-policies";

// ============================================================================
// 1. PROJECT ARCHIVE MODAL
// ============================================================================

interface ProjectArchiveModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isArchived: boolean;
    activeTasksCount: number;
    openRolesCount: number;
    loading: boolean;
    onConfirmArchive: () => Promise<void>;
}

export function ProjectArchiveModal({
    open,
    onOpenChange,
    isArchived,
    activeTasksCount,
    openRolesCount,
    loading,
    onConfirmArchive,
}: ProjectArchiveModalProps) {
    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!loading) onOpenChange(nextOpen);
        }}>
            <DialogContent className="max-w-lg rounded-[12px] p-0 overflow-hidden border-border bg-card">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-[5px] border border-border bg-muted/50 text-foreground">
                            <Archive className="size-4" />
                        </div>
                        <div>
                            <DialogTitle className="nb-card-title text-base text-foreground">
                                {isArchived ? "Unarchive workspace" : "Archive workspace"}
                            </DialogTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                    {isArchived ? "STATUS: ARCHIVED" : "STATUS: ACTIVE"}
                                </span>
                                <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                    REVERSIBLE
                                </span>
                            </div>
                        </div>
                    </div>
                    <DialogDescription className="nb-compact mt-2 text-xs text-muted-foreground">
                        {isArchived
                            ? "Restore active collaboration, intake, notifications, and publishing in this workspace."
                            : "Archive marks this workspace as read-only. Existing members keep safe access for historical context."}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 space-y-3">
                    <div className="rounded-[6px] border border-border bg-muted/30 p-3.5 text-xs space-y-2">
                        <p className="nb-ui-label text-foreground font-semibold">
                            {isArchived ? "Unarchiving effects:" : "Archiving effects:"}
                        </p>
                        <ul className="space-y-1.5 nb-compact text-muted-foreground">
                            {isArchived ? (
                                <>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>Restores normal task updates, sprints, and documentation editing.</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>Re-enables application intake and open role matching.</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>Restores discovery visibility in hub and portfolio feeds.</span>
                                    </li>
                                </>
                            ) : (
                                <>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>Marks all task boards, documents, and workspace views as read-only.</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>Pauses active task assignments ({activeTasksCount} active) and open role intake ({openRolesCount} open).</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>All historical records, file attachments, and discussion logs are permanently preserved.</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-foreground mt-0.5">•</span>
                                        <span>This operation is fully reversible and can be unarchived at any time.</span>
                                    </li>
                                </>
                            )}
                        </ul>
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                        className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant={isArchived ? "default" : "destructive"}
                        onClick={onConfirmArchive}
                        disabled={loading}
                        className="nb-touch-target h-[34px] gap-2 rounded-[5px] px-4 text-[13px] font-medium"
                    >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
                        {isArchived ? "Unarchive workspace" : "Archive workspace"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ============================================================================
// 2. PROJECT TRANSFER OWNERSHIP MODAL (HIGH-STAKES VERIFICATION BARRIER)
// ============================================================================

interface ProjectTransferOwnershipModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    candidate: ProjectSettingsMember | null;
    projectSlug: string;
    projectTitle: string;
    loading: boolean;
    onConfirmTransfer: (candidate: ProjectSettingsMember) => Promise<void>;
}

export function ProjectTransferOwnershipModal({
    open,
    onOpenChange,
    candidate,
    projectSlug,
    projectTitle,
    loading,
    onConfirmTransfer,
}: ProjectTransferOwnershipModalProps) {
    const [confirmInput, setConfirmInput] = useState("");

    // Reset verification input whenever dialog opens or candidate changes
    useEffect(() => {
        if (open) {
            setConfirmInput("");
        }
    }, [open, candidate?.id]);

    if (!candidate) return null;

    const candidateDisplayName = getProjectMemberDisplayName(candidate);
    const candidateUsername = candidate.username?.trim() || "";
    const verificationTarget = candidateUsername || candidateDisplayName;
    const isConfirmed = confirmInput.trim().toLowerCase() === verificationTarget.toLowerCase();

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!loading) {
                setConfirmInput("");
                onOpenChange(nextOpen);
            }
        }}>
            <DialogContent className="max-w-lg rounded-[12px] p-0 overflow-hidden border-border bg-card">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-[5px] border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            <Crown className="size-4" />
                        </div>
                        <div>
                            <DialogTitle className="nb-card-title text-base text-foreground">
                                Transfer workspace ownership
                            </DialogTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="inline-flex h-5 items-center rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                                    OWNER ONLY
                                </span>
                                <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                    STEP-UP PROTECTED
                                </span>
                            </div>
                        </div>
                    </div>
                    <DialogDescription className="nb-compact mt-2 text-xs text-muted-foreground">
                        You are about to transfer primary administrative ownership of &ldquo;{projectTitle}&rdquo;. This action permanently changes workspace control.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 space-y-4">
                    {/* Recipient identity card */}
                    <div className="rounded-[6px] border border-border bg-muted/20 p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="size-10 rounded-[5px] border border-border shrink-0">
                                <AvatarImage src={candidate.avatarUrl ?? undefined} alt={candidateDisplayName} />
                                <AvatarFallback identityKey={candidate.id} className="rounded-[5px] bg-muted text-xs font-mono font-medium">
                                    {candidateDisplayName.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="nb-ui-label text-sm font-semibold text-foreground truncate">
                                        {candidateDisplayName}
                                    </span>
                                </div>
                                {candidateUsername ? (
                                    <p className="nb-meta text-xs text-muted-foreground truncate">
                                        @{candidateUsername}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                        <span className="inline-flex h-5 shrink-0 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                            CURRENT: {getProjectMemberRoleLabel(candidate.membershipRole)}
                        </span>
                    </div>

                    {/* Consequence warning */}
                    <div className="rounded-[6px] border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                        <p className="nb-ui-label font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            Ownership consequence review
                        </p>
                        <ul className="space-y-1 nb-compact text-xs leading-5">
                            <li className="flex items-start gap-1.5">
                                <span className="font-bold">•</span>
                                <span>You’ll become an <strong>admin</strong> and lose owner permissions.</span>
                            </li>
                            <li className="flex items-start gap-1.5">
                                <span className="font-bold">•</span>
                                <span><strong>{candidateDisplayName}</strong> will gain full Owner control over workspace visibility, team roster, settings, and deletion.</span>
                            </li>
                            <li className="flex items-start gap-1.5">
                                <span className="font-bold">•</span>
                                <span>This transfer takes effect immediately. Only the new owner can return ownership to you.</span>
                            </li>
                        </ul>
                    </div>

                    {/* Verification Barrier */}
                    <div className="space-y-1.5">
                        <label htmlFor="confirm-transfer-input" className="block nb-ui-label text-xs font-medium text-foreground">
                            To confirm transfer, type <span className="font-mono font-semibold text-foreground">&ldquo;{verificationTarget}&rdquo;</span> below:
                        </label>
                        <input
                            id="confirm-transfer-input"
                            type="text"
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder={`Type "${verificationTarget}" to confirm`}
                            autoComplete="off"
                            spellCheck={false}
                            className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setConfirmInput("");
                            onOpenChange(false);
                        }}
                        disabled={loading}
                        className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={() => onConfirmTransfer(candidate)}
                        disabled={loading || !isConfirmed}
                        className="nb-touch-target h-[34px] gap-2 rounded-[5px] px-4 text-[13px] font-medium"
                    >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Crown className="size-4" />}
                        Transfer ownership
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ============================================================================
// 3. PROJECT DELETE MODAL (STRICT SLUG TYPE-TO-CONFIRM BARRIER)
// ============================================================================

interface ProjectDeleteModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectSlug: string;
    projectTitle: string;
    preflight: {
        activeTasksCount: number;
        openRolesCount: number;
        pendingApplicationsCount: number;
        affectedAreas: string[];
    } | null;
    loading: boolean;
    onConfirmDelete: () => Promise<void>;
}

export function ProjectDeleteModal({
    open,
    onOpenChange,
    projectSlug,
    projectTitle,
    preflight,
    loading,
    onConfirmDelete,
}: ProjectDeleteModalProps) {
    const [confirmInput, setConfirmInput] = useState("");

    // Required slug or title verification string
    const requiredSlug = (projectSlug || projectTitle).trim();
    const isConfirmed = confirmInput.trim() === requiredSlug;

    // Reset input on open change
    useEffect(() => {
        if (open) {
            setConfirmInput("");
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!loading) {
                setConfirmInput("");
                onOpenChange(nextOpen);
            }
        }}>
            <DialogContent className="max-w-lg rounded-[12px] p-0 overflow-hidden border-border bg-card">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-[5px] border border-destructive/30 bg-destructive/10 text-destructive">
                            <Trash2 className="size-4" />
                        </div>
                        <div>
                            <DialogTitle className="nb-card-title text-base text-destructive">
                                Delete workspace permanently
                            </DialogTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="inline-flex h-5 items-center rounded-[3px] border border-destructive/20 bg-destructive/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-destructive">
                                    PERMANENT
                                </span>
                                <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                    IRREVERSIBLE
                                </span>
                            </div>
                        </div>
                    </div>
                    <DialogDescription className="nb-compact mt-2 text-xs text-muted-foreground">
                        This action will permanently delete &ldquo;{projectTitle}&rdquo; and all associated workspaces, tasks, files, and discussion history.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 space-y-4">
                    {/* High-stakes destructive banner */}
                    <div className="rounded-[6px] border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive space-y-1.5">
                        <p className="nb-ui-label font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="size-3.5 shrink-0" />
                            Warning: Irreversible destruction
                        </p>
                        <p className="nb-compact text-xs leading-5 text-destructive/90">
                            Once confirmed, this workspace is purged immediately. Cloud S3 files, task records, sprint data, and member permissions cannot be recovered or restored.
                        </p>
                    </div>

                    {/* Preflight Impact Checklist */}
                    <div className="rounded-[6px] border border-border bg-muted/20 p-3.5 space-y-2">
                        <p className="nb-micro text-muted-foreground">Data to be destroyed:</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-[4px] border border-border bg-card p-2">
                                <span className="nb-meta block text-muted-foreground text-[11px]">ACTIVE TASKS</span>
                                <span className="nb-ui-label text-sm font-semibold text-foreground">
                                    {preflight?.activeTasksCount ?? 0}
                                </span>
                            </div>
                            <div className="rounded-[4px] border border-border bg-card p-2">
                                <span className="nb-meta block text-muted-foreground text-[11px]">OPEN ROLES</span>
                                <span className="nb-ui-label text-sm font-semibold text-foreground">
                                    {preflight?.openRolesCount ?? 0}
                                </span>
                            </div>
                        </div>
                        <ul className="space-y-1 nb-compact text-[11px] text-muted-foreground pt-1">
                            <li className="flex items-center gap-1.5">
                                <span>•</span>
                                <span>All repository files, folders, and S3 file revisions</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                                <span>•</span>
                                <span>Workspace documents, update announcements, and comments</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                                <span>•</span>
                                <span>All member collaboration channels and permissions</span>
                            </li>
                        </ul>
                    </div>

                    {/* Strict Slug Type-to-Confirm Barrier */}
                    <div className="space-y-1.5">
                        <label htmlFor="confirm-delete-slug-input" className="block nb-ui-label text-xs font-medium text-foreground">
                            To confirm deletion, type <span className="font-mono font-semibold text-destructive">&ldquo;{requiredSlug}&rdquo;</span> below:
                        </label>
                        <input
                            id="confirm-delete-slug-input"
                            type="text"
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder={`Type "${requiredSlug}" to delete`}
                            autoComplete="off"
                            spellCheck={false}
                            className="nb-touch-target h-[34px] w-full rounded-[5px] border border-destructive/40 bg-background px-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-destructive focus:outline-none focus:ring-1 focus:ring-destructive"
                        />
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setConfirmInput("");
                            onOpenChange(false);
                        }}
                        disabled={loading}
                        className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirmDelete}
                        disabled={loading || !isConfirmed}
                        className="nb-touch-target h-[34px] gap-2 rounded-[5px] px-4 text-[13px] font-medium"
                    >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        Delete workspace permanently
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
