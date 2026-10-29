"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { AlertCircle, Briefcase, Check, Loader2, Search, Users } from "lucide-react";
import { usePlainContentHeadings } from "@/components/workspaces/PlainContentHeadings";
import { del, get, set } from "idb-keyval";
import { toast } from "@/lib/feedback";
import { Virtuoso } from "react-virtuoso";

import { applyToRoleAction, editPendingApplicationAction, getWorkspaceInviteOptionsAction } from "@/app/actions/applications";
import type { ApplicationActionErrorCode } from "@/app/actions/applications";
import {
    createWorkspaceInvitationAction,
    getWorkspaceGuidancePreflightAction,
    searchWorkspaceInviteCandidatesAction,
} from "@/app/actions/workspace/guidance";
import { getProfileToRoleAlignmentAction, type AttributeAlignment } from "@/app/actions/matchmaking/resolver";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { conversationHref } from "@/lib/messaging/routes";
import { logger } from "@/lib/logger";

export type ParticipationRole = {
    id: string;
    title?: string | null;
    role?: string | null;
    count?: number | null;
    filled?: number | null;
    description?: string | null;
    skills?: string[] | null;
};

export type ParticipationWorkspace = {
    id: string;
    title: string;
    slug?: string | null;
    role?: "owner" | "admin";
    openRoles?: ParticipationRole[];
};

type Candidate = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    state?: "eligible" | "application_pending" | "invitation_pending";
};

type InvitationKind = "ordinary_role" | "guidance_appointment";
type GuidancePreflight = { activeGuide: { label: string; name: string } | null; capacity: "available" | "warning" | "blocked" };
type CachedOptions = { roles: ParticipationRole[]; people: Candidate[] };

/** What a successful apply or edit hands back, so the page can show Pending before it re-reads. */
export type ApplySuccessHandler = (result?: { applicationId?: string; channelId?: string | null; roleId?: string }) => void;

/** Who leads the project (its owner): shown to an applicant as the person they are writing to. */
export type WorkspaceLead = { id: string; username?: string | null; fullName?: string | null; avatarUrl?: string | null };

/** A pending application opened for editing. */
export type EditableApplication = {
    applicationId: string;
    roleId?: string;
    message: string;
    details?: { portfolioUrl?: string; availability?: string };
};

export interface InviteCollaboratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: ApplySuccessHandler;
    /** Apply mode: change this pending application instead of submitting a new one. */
    editApplication?: EditableApplication;
    /** Apply mode: a role turned out to be full or gone, so the page should re-read its roles. */
    onRolesStale?: () => void;
    /** Apply mode: the project's lead, so the applicant sees who they are writing to. */
    lead?: WorkspaceLead;
    mode?: "invite" | "apply";
    projectId?: string;
    projectTitle?: string;
    roles?: ParticipationRole[];
    projects?: ParticipationWorkspace[];
    preselectedRoleId?: string;
    candidate?: Candidate;
    canAppointGuidance?: boolean;
}

const APPLICATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOTE_LIMIT = 500;
const APPLICATION_LIMIT = 1200;
const PORTFOLIO_LIMIT = 300;
const AVAILABILITY_LIMIT = 120;

/** What the applicant is told for each way a submit can fail; the server's own text is the fallback. */
function applyErrorCopy(code: ApplicationActionErrorCode | undefined, fallback?: string) {
    switch (code) {
        case "RATE_LIMITED": return "You are sending applications quickly. Wait a moment, then try again.";
        case "ROLE_FULL": return "That role was just filled. Choose another role.";
        case "ROLE_NOT_FOUND": return "That role was removed. Choose another role.";
        case "ALREADY_PENDING": return "You already have a pending application for this workspace. Nothing was changed.";
        default: return fallback || "Couldn’t submit the application.";
    }
}

function roleLabel(role: ParticipationRole) {
    return role.title || role.role || "Role";
}

function remainingRoles(role: ParticipationRole) {
    return Math.max(0, Number(role.count ?? 0) - Number(role.filled ?? 0));
}

function displayName(candidate: Candidate) {
    return candidate.fullName || candidate.username || "Person";
}

function queryBucket(query: string) {
    if (!query) return "empty";
    if (query.length <= 4) return "2-4";
    if (query.length <= 8) return "5-8";
    return "9+";
}

async function fingerprint(value: string) {
    if (globalThis.crypto?.subtle) {
        const bytes = new TextEncoder().encode(value);
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    // ponytail: legacy browsers fall back to a string hash; modern browsers take the SHA-256 path. ceiling: the fallback hash is not collision-resistant. upgrade: drop the fallback when legacy browser support ends.
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    return Math.abs(hash).toString(16);
}

function normalizePortfolioUrl(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
        const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
        return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null;
    } catch {
        return null;
    }
}

/** One visual recruitment surface; invitation and application server commands remain deliberately separate. */
export default function InviteCollaboratorModal({
    isOpen,
    onClose,
    onSuccess,
    mode = "invite",
    projectId,
    projectTitle,
    roles,
    projects,
    preselectedRoleId,
    candidate: initialCandidate,
    canAppointGuidance = false,
    editApplication,
    onRolesStale,
    lead,
}: InviteCollaboratorModalProps) {
    const plainContentHeadings = usePlainContentHeadings();
    const { user } = useAuth();
    const router = useRouter();
    const queryClient = useQueryClient();
    const phone = useMediaQuery("(max-width: 639px)");
    // The edit target is read when the dialog opens; a new object on every parent render must not reset the form.
    const editRef = useRef(editApplication);
    editRef.current = editApplication;
    const isEditing = mode === "apply" && Boolean(editApplication);
    const completedRef = useRef(false);
    const portfolioRef = useRef<HTMLInputElement>(null);
    const projectListRef = useRef<HTMLDivElement>(null);
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState(projectId || "");
    const [projectRoles, setProjectRoles] = useState<ParticipationRole[]>(roles || []);
    const [people, setPeople] = useState<Candidate[]>([]);
    const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(initialCandidate || null);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleId, setRoleId] = useState(preselectedRoleId || "");
    const [inviteKind, setInviteKind] = useState<InvitationKind>("ordinary_role");
    const [guidanceLabel, setGuidanceLabel] = useState("Mentor");
    const [reviewAt, setReviewAt] = useState("");
    const [note, setNote] = useState("");
    const [applicationMessage, setApplicationMessage] = useState("");
    const [portfolioUrl, setPortfolioUrl] = useState("");
    const [availability, setAvailability] = useState("");
    const [alignment, setAlignment] = useState<AttributeAlignment | null>(null);
    const [guidancePreflight, setGuidancePreflight] = useState<GuidancePreflight | null>(null);
    const [guidanceLoading, setGuidanceLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [portfolioError, setPortfolioError] = useState<string | null>(null);
    const [staleRoleIds, setStaleRoleIds] = useState<string[]>([]);
    const [applicationDraftLoaded, setApplicationDraftLoaded] = useState(false);
    const [optionsVersion, setOptionsVersion] = useState(0);
    const [isChoosingProject, setIsChoosingProject] = useState(false);

    const optionsCache = useRef(new Map<string, CachedOptions>());
    const searchCache = useRef(new Map<string, Candidate[]>());
    const guidancePreflightCache = useRef(new Map<string, GuidancePreflight>());
    const searchSequence = useRef(0);
    const guidanceSequence = useRef(0);
    const openedAt = useRef(0);
    const projectPickerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const roleSelectRef = useRef<HTMLSelectElement>(null);
    const guidanceLabelRef = useRef<HTMLInputElement>(null);
    const applicationMessageRef = useRef<HTMLTextAreaElement>(null);

    const projectOptions = useMemo<ParticipationWorkspace[]>(() => {
        if (projectId && projectTitle) {
            return [{ id: projectId, title: projectTitle, role: canAppointGuidance ? "owner" : "admin", openRoles: roles }];
        }
        return projects || [];
    }, [canAppointGuidance, projectId, projectTitle, projects, roles]);
    const selectedProject = projectOptions.find((project) => project.id === selectedProjectId) || null;
    const activeRoles = mode === "apply" && selectedProject?.openRoles ? selectedProject.openRoles : projectRoles;
    const selectableRoles = useMemo(() => activeRoles.filter((role) => remainingRoles(role) > 0 && !staleRoleIds.includes(role.id)), [activeRoles, staleRoleIds]);
    const selectableRoleKey = useMemo(() => selectableRoles.map((role) => role.id).join("|"), [selectableRoles]);
    const selectedRole = activeRoles.find((role) => role.id === roleId) || null;
    const candidateIsFixed = Boolean(initialCandidate);
    const projectIsFixed = Boolean(projectId);
    const canAppointSelectedGuidance = mode === "invite" && (canAppointGuidance || selectedProject?.role === "owner");
    const hasPendingApplication = selectedCandidate?.state === "application_pending";
    const hasPendingInvitation = selectedCandidate?.state === "invitation_pending";
    const applicationDraftKey = `recruitment-application-draft:v2:${user?.id || "anonymous"}:${selectedProjectId || "select"}`;
    const guidanceUnavailable = Boolean(guidancePreflight?.activeGuide || guidancePreflight?.capacity === "blocked");
    const showProjectPicker = !projectIsFixed && (!selectedProject || isChoosingProject);

    // One inline alert, never a toast as well: the message stays beside the field it is about.
    const showError = (message: string, focus?: React.RefObject<HTMLElement | null>) => {
        setFormError(message);
        window.requestAnimationFrame(() => focus?.current?.focus());
    };

    const refreshProjectOptions = (affectedProjectId: string) => {
        optionsCache.current.delete(affectedProjectId);
        for (const key of searchCache.current.keys()) {
            if (key.startsWith(`${affectedProjectId}:`)) searchCache.current.delete(key);
        }
        setOptionsVersion((version) => version + 1);
    };

    const closeComposer = (reason: "cancelled" | "dismissed" | "completed") => {
        logger.metric("recruitment.composer.closed", {
            module: "recruitment-composer",
            kind: mode,
            reason,
            durationMs: openedAt.current ? Math.round(performance.now() - openedAt.current) : 0,
        });
        onClose();
    };

    useEffect(() => {
        if (isOpen) {
            openedAt.current = performance.now();
            setSelectedProjectId(projectId || projects?.[0]?.id || "");
            setSelectedCandidate(initialCandidate || null);
            setSearchQuery("");
            const editing = editRef.current;
            completedRef.current = false;
            setRoleId(editing?.roleId || preselectedRoleId || "");
            setInviteKind("ordinary_role");
            setGuidanceLabel("Mentor");
            setReviewAt("");
            setNote("");
            setApplicationMessage(editing?.message ?? "");
            setPortfolioUrl(editing?.details?.portfolioUrl ?? "");
            setAvailability(editing?.details?.availability ?? "");
            setAlignment(null);
            setGuidancePreflight(null);
            setFormError(null);
            setPortfolioError(null);
            setStaleRoleIds([]);
            setApplicationDraftLoaded(mode !== "apply" || Boolean(editing));
            setIsChoosingProject(false);
            logger.metric("recruitment.composer.opened", { module: "recruitment-composer", kind: mode, route: projectIsFixed ? "project" : "profile" });
        } else {
            optionsCache.current.clear();
            searchCache.current.clear();
            guidancePreflightCache.current.clear();
            searchSequence.current += 1;
            guidanceSequence.current += 1;
        }
    }, [initialCandidate, isOpen, mode, preselectedRoleId, projectId, projectIsFixed, projects, editApplication?.applicationId]);

    useEffect(() => {
        if (isChoosingProject) window.requestAnimationFrame(() => projectPickerRef.current?.focus());
    }, [isChoosingProject]);

    useEffect(() => {
        if (!isOpen || !selectedProjectId) return;
        if (mode === "apply" && selectedProject?.openRoles) {
            setProjectRoles(selectedProject.openRoles);
            return;
        }
        if (projectIsFixed && roles) {
            setProjectRoles(roles);
            return;
        }
        const cached = optionsCache.current.get(selectedProjectId);
        if (cached) {
            setProjectRoles(cached.roles);
            if (mode === "invite" && !candidateIsFixed) setPeople(cached.people);
            return;
        }
        let cancelled = false;
        setLoadingOptions(true);
        const startedAt = performance.now();
        void getWorkspaceInviteOptionsAction(selectedProjectId).then((result) => {
            if (cancelled) return;
            if (!result.success) {
                logger.metric("recruitment.composer.options", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                showError(result.error || "Couldn’t load workspace options", projectPickerRef);
                setProjectRoles([]);
                return;
            }
            const initialPeople: Candidate[] = (result.connections || []).map((person) => ({
                id: person.id,
                username: person.username,
                fullName: person.fullName,
                avatarUrl: person.avatarUrl,
                headline: person.headline,
                state: person.pendingApplicationId ? "application_pending" : person.pendingInvitations.length ? "invitation_pending" : "eligible",
            }));
            const cachedOptions = { roles: result.openRoles || [], people: initialPeople };
            optionsCache.current.set(selectedProjectId, cachedOptions);
            setProjectRoles(cachedOptions.roles);
            if (mode === "invite" && !candidateIsFixed) setPeople(initialPeople);
            logger.metric("recruitment.composer.options", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode, outcome: "success", durationMs: Math.round(performance.now() - startedAt) });
        }).catch(() => {
            if (!cancelled) {
                logger.metric("recruitment.composer.options", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                showError("Couldn’t load workspace options", projectPickerRef);
            }
        }).finally(() => {
            if (!cancelled) setLoadingOptions(false);
        });
        return () => { cancelled = true; };
    }, [candidateIsFixed, isOpen, mode, optionsVersion, projectIsFixed, roles, selectedProject?.openRoles, selectedProjectId]);

    useEffect(() => {
        if (!isOpen || mode !== "invite" || candidateIsFixed || !selectedProjectId || selectedCandidate) return;
        const query = searchQuery.trim();
        if (query.length < 2) {
            setSearching(false);
            if (!query) setPeople(optionsCache.current.get(selectedProjectId)?.people || []);
            return;
        }
        const cacheKey = `${selectedProjectId}:${query.toLowerCase()}`;
        const cached = searchCache.current.get(cacheKey);
        if (cached) {
            setPeople(cached);
            return;
        }
        const request = ++searchSequence.current;
        const startedAt = performance.now();
        const timer = window.setTimeout(() => {
            setSearching(true);
            void searchWorkspaceInviteCandidatesAction({ projectId: selectedProjectId, query }).then((result) => {
                if (request !== searchSequence.current) return;
                if (!result.success) {
                    logger.metric("recruitment.composer.search", { module: "recruitment-composer", projectId: selectedProjectId, queryLengthBucket: queryBucket(query), durationMs: Math.round(performance.now() - startedAt), outcome: "failure" });
                    showError(result.error || "Couldn’t search people", searchInputRef);
                    return;
                }
                const items = result.items.map((person) => ({ ...person, state: person.state as Candidate["state"] }));
                searchCache.current.set(cacheKey, items);
                setPeople(items);
                logger.metric("recruitment.composer.search", {
                    module: "recruitment-composer",
                    projectId: selectedProjectId,
                    queryLengthBucket: queryBucket(query),
                    resultCount: items.length,
                    durationMs: Math.round(performance.now() - startedAt),
                    outcome: "success",
                });
            }).catch(() => {
                if (request === searchSequence.current) {
                    logger.metric("recruitment.composer.search", { module: "recruitment-composer", projectId: selectedProjectId, queryLengthBucket: queryBucket(query), durationMs: Math.round(performance.now() - startedAt), outcome: "failure" });
                    showError("Couldn’t search people", searchInputRef);
                }
            }).finally(() => {
                if (request === searchSequence.current) setSearching(false);
            });
        }, 280);
        return () => window.clearTimeout(timer);
    }, [candidateIsFixed, isOpen, mode, searchQuery, selectedCandidate, selectedProjectId]);

    useEffect(() => {
        const defaultRole = preselectedRoleId && selectableRoles.some((role) => role.id === preselectedRoleId)
            ? preselectedRoleId
            : selectableRoles[0]?.id || "";
        setRoleId((current) => selectableRoles.some((role) => role.id === current) ? current : defaultRole);
    }, [preselectedRoleId, selectableRoleKey, selectedProjectId]);

    useEffect(() => {
        if (!isOpen || mode !== "apply" || isEditing || !selectedProjectId || !user?.id) return;
        let cancelled = false;
        setApplicationDraftLoaded(false);
        void get(applicationDraftKey).then(async (raw) => {
            if (cancelled || !raw || typeof raw !== "object") return;
            const draft = raw as { version?: number; savedAt?: number; roleId?: string; message?: string; portfolioUrl?: string; availability?: string };
            if (draft.version && draft.version !== 1) {
                await del(applicationDraftKey);
                return;
            }
            if (!draft.savedAt || Date.now() - draft.savedAt > APPLICATION_DRAFT_TTL_MS) {
                await del(applicationDraftKey);
                return;
            }
            if (draft.roleId && selectableRoles.some((role) => role.id === draft.roleId)) setRoleId(draft.roleId);
            setApplicationMessage((draft.message || "").slice(0, APPLICATION_LIMIT));
            setPortfolioUrl(draft.portfolioUrl || "");
            setAvailability(draft.availability || "");
        }).catch(() => undefined).finally(() => {
            if (!cancelled) setApplicationDraftLoaded(true);
        });
        return () => { cancelled = true; };
    }, [applicationDraftKey, isEditing, isOpen, mode, selectableRoleKey, selectedProjectId, user?.id]);

    useEffect(() => {
        if (!isOpen || mode !== "apply" || isEditing || !selectedProjectId || !user?.id || !applicationDraftLoaded) return;
        const timer = window.setTimeout(() => {
            const hasDraft = applicationMessage.trim() || portfolioUrl.trim() || availability.trim();
            void (hasDraft
                ? set(applicationDraftKey, { version: 1, roleId, message: applicationMessage, portfolioUrl, availability, savedAt: Date.now() })
                : del(applicationDraftKey)
            );
        }, 750);
        return () => window.clearTimeout(timer);
    }, [applicationDraftKey, applicationDraftLoaded, applicationMessage, availability, isEditing, isOpen, mode, portfolioUrl, roleId, selectedProjectId, user?.id]);

    useEffect(() => {
        if (!selectedCandidate || !selectedProject || mode !== "invite" || inviteKind === "guidance_appointment") return;
        const role = activeRoles.find((item) => item.id === roleId);
        setNote(`Hey ${displayName(selectedCandidate)}, I think you’d be a great fit for the ${role ? roleLabel(role) : "member"} role on ${selectedProject.title}. Let’s build this together`);
    }, [activeRoles, inviteKind, mode, roleId, selectedCandidate, selectedProject]);

    useEffect(() => {
        if (mode !== "invite" || inviteKind !== "ordinary_role" || !selectedCandidate || !roleId) {
            setAlignment(null);
            return;
        }
        let cancelled = false;
        void getProfileToRoleAlignmentAction(selectedCandidate.id, roleId).then((result) => {
            if (!cancelled) setAlignment(result);
        }).catch(() => {
            if (!cancelled) setAlignment(null);
        });
        return () => { cancelled = true; };
    }, [inviteKind, mode, roleId, selectedCandidate]);

    useEffect(() => {
        if (mode !== "invite" || inviteKind !== "guidance_appointment" || !selectedCandidate || !selectedProject || !canAppointSelectedGuidance) {
            setGuidancePreflight(null);
            return;
        }
        const cacheKey = `${selectedProject.id}:${selectedCandidate.id}`;
        const cached = guidancePreflightCache.current.get(cacheKey);
        if (cached) {
            setGuidancePreflight(cached);
            setGuidanceLoading(false);
            return;
        }
        const request = ++guidanceSequence.current;
        const startedAt = performance.now();
        let cancelled = false;
        setGuidanceLoading(true);
        void getWorkspaceGuidancePreflightAction({ projectId: selectedProject.id, candidateId: selectedCandidate.id }).then((result) => {
            if (cancelled || request !== guidanceSequence.current) return;
            if (!result.success) {
                logger.metric("recruitment.composer.guidance_preflight", { module: "recruitment-composer", projectId: selectedProject.id, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                setGuidancePreflight(null);
                showError(result.error || "Couldn’t check the mentor invitation");
                return;
            }
            const preflight = { activeGuide: result.activeGuide, capacity: result.capacity };
            guidancePreflightCache.current.set(cacheKey, preflight);
            setGuidancePreflight(preflight);
            logger.metric("recruitment.composer.guidance_preflight", { module: "recruitment-composer", projectId: selectedProject.id, outcome: "success", durationMs: Math.round(performance.now() - startedAt) });
        }).catch(() => {
            if (!cancelled && request === guidanceSequence.current) {
                logger.metric("recruitment.composer.guidance_preflight", { module: "recruitment-composer", projectId: selectedProject.id, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                showError("Couldn’t check the mentor invitation");
            }
        }).finally(() => {
            if (!cancelled && request === guidanceSequence.current) setGuidanceLoading(false);
        });
        return () => { cancelled = true; guidanceSequence.current += 1; };
    }, [canAppointSelectedGuidance, inviteKind, mode, selectedCandidate, selectedProject]);

    const selectCandidate = (candidate: Candidate) => {
        setSelectedCandidate(candidate);
        setFormError(null);
        logger.metric("recruitment.composer.candidate_selected", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode });
        window.requestAnimationFrame(() => roleSelectRef.current?.focus());
    };

    const submit = async () => {
        if (!selectedProject) return showError("Select a workspace first", projectPickerRef);
        if (mode === "invite" && !selectedCandidate) return showError("Select a person to invite", searchInputRef);
        if ((mode === "apply" || inviteKind === "ordinary_role") && !roleId) return showError("Select an available role", roleSelectRef);
        if (mode === "invite" && hasPendingApplication) return showError("Review the existing application before sending an invitation");
        if (mode === "invite" && hasPendingInvitation) return showError("An invitation is already pending for this person");
        if (mode === "invite" && inviteKind === "guidance_appointment" && !guidanceLabel.trim()) return showError("Enter a mentor focus", guidanceLabelRef);
        if (mode === "invite" && inviteKind === "guidance_appointment" && guidanceUnavailable) return showError(guidancePreflight?.activeGuide ? "This workspace already has a mentor" : "This person has reached their mentor limit");
        if (mode === "apply" && !applicationMessage.trim()) return showError("Add a short application message", applicationMessageRef);

        const startedAt = performance.now();
        setSubmitting(true);
        setFormError(null);
        setPortfolioError(null);
        let applied: { applicationId?: string; channelId?: string | null; roleId?: string } | undefined;
        try {
            if (mode === "apply") {
                const safePortfolioUrl = normalizePortfolioUrl(portfolioUrl);
                if (safePortfolioUrl === null) {
                    setPortfolioError("Enter a valid link, like https://github.com/you");
                    return showError("Check the portfolio link.", portfolioRef);
                }
                const message = applicationMessage.trim();
                const details = { portfolioUrl: safePortfolioUrl || undefined, availability: availability.trim() || undefined };
                const idempotencyKey = `apply:${await fingerprint(`${selectedProject.id}:${roleId}:${message}:${details.portfolioUrl ?? ""}:${details.availability ?? ""}`)}`;
                const editing = editRef.current;
                const result = editing
                    ? await editPendingApplicationAction(editing.applicationId, message, roleId !== editing.roleId ? roleId : null, { idempotencyKey, details })
                    : await applyToRoleAction(selectedProject.id, roleId, message, { idempotencyKey, details });
                if (!result.success) {
                    logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "failure", errorCode: result.errorCode || "APPLICATION_FAILED", durationMs: Math.round(performance.now() - startedAt) });
                    const roleGone = result.errorCode === "ROLE_FULL" || result.errorCode === "ROLE_NOT_FOUND";
                    if (roleGone) {
                        setStaleRoleIds((ids) => [...ids, roleId]);
                        setRoleId("");
                        onRolesStale?.();
                    }
                    return showError(applyErrorCopy(result.errorCode, result.error), roleGone ? roleSelectRef : applicationMessageRef);
                }
                completedRef.current = true;
                // The cards on Discover and profiles read your application separately: tell them it changed.
                void queryClient.invalidateQueries({ queryKey: queryKeys.discover.myApplications(user?.id) });
                applied = { applicationId: result.applicationId, channelId: result.channelId, roleId };
                if (user?.id && !editing) await del(applicationDraftKey);
                const title = editing || result.outcome === "updated" ? "Application updated"
                    : result.outcome === "already_pending" ? "You already have this application pending"
                        : "Application submitted";
                const channelId = result.channelId;
                toast.success(title, {
                    description: result.outcome === "submitted" || result.outcome === "resubmitted" ? "The reviewers have been notified." : undefined,
                    action: channelId ? { label: "View conversation", onClick: () => router.push(conversationHref(channelId)) } : undefined,
                });
            } else {
                const payload = `${selectedProject.id}:${selectedCandidate!.id}:${inviteKind}:${roleId}:${guidanceLabel.trim()}:${reviewAt}:${note.trim()}`;
                const result = await createWorkspaceInvitationAction({
                    projectId: selectedProject.id,
                    candidateId: selectedCandidate!.id,
                    kind: inviteKind,
                    roleId: inviteKind === "ordinary_role" ? roleId : null,
                    note: note.trim() || null,
                    guidanceLabel: inviteKind === "guidance_appointment" ? guidanceLabel : null,
                    reviewAt: inviteKind === "guidance_appointment" ? reviewAt || null : null,
                    idempotencyKey: `invite:${await fingerprint(payload)}`,
                });
                if (!result.success) {
                    logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "failure", errorCode: "INVITATION_FAILED", durationMs: Math.round(performance.now() - startedAt) });
                    if (/role is no longer available|guidance appointment/i.test(result.error || "")) refreshProjectOptions(selectedProject.id);
                    return showError(result.error || "Couldn’t send invitation");
                }
                toast.success(result.capacityWarning ? "Invitation sent" : "Invitation sent");
            }
            logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "success", durationMs: Math.round(performance.now() - startedAt) });
            onSuccess?.(applied);
            closeComposer("completed");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Couldn’t complete this action";
            logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
            showError(message);
        } finally {
            setSubmitting(false);
        }
    };

    // Why Submit is off, said next to it, instead of leaving a grey button unexplained.
    const submitBlocker = mode !== "apply" ? null
        : !selectedProject ? "Choose a workspace to apply to."
            : !roleId ? (selectableRoles.length ? "Choose a role." : "No roles are open right now.")
                : !applicationMessage.trim() ? "Tell the reviewers why you are a fit." : null;

    const step = (label: string) => <p className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">{label}</p>;
    const selectedProjectContext = selectedProject ? <div className="flex items-center justify-between rounded-[5px] border border-border bg-muted/30 px-3.5 py-2.5 text-[13px] text-foreground"><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 truncate"><span className="text-muted-foreground">Project:</span> <strong>{selectedProject.title}</strong></span>{mode === "apply" && lead ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><UserAvatar identity={lead} size={18} />Lead: {lead.fullName || lead.username}</span> : null}</span>{!projectIsFixed ? <Button type="button" variant="ghost" size="sm" aria-expanded={isChoosingProject} aria-controls="recruitment-project-list" onClick={() => setIsChoosingProject((open) => !open)} className="nb-touch-target h-[28px] rounded-[5px] px-2 text-xs font-medium">{isChoosingProject ? "Cancel" : "Change"}</Button> : null}</div> : null;
    // An anchored list keeps the application form and modal dimensions intact.
    const projectPicker = showProjectPicker ? <div ref={projectPickerRef} tabIndex={-1} className="absolute inset-x-0 top-full z-10 mt-2 animate-in fade-in slide-in-from-top-1 duration-[130ms] rounded-[8px] border border-border bg-card p-2 shadow-md outline-none">{step("Select workspace")}<div
                ref={projectListRef}
                id="recruitment-project-list"
                role="listbox"
                aria-label="Available workspaces"
                onKeyDown={(event) => {
                    const options = Array.from(projectListRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
                    const at = options.indexOf(document.activeElement as HTMLElement);
                    const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
                    if (next === null || !options.length) return;
                    event.preventDefault();
                    options[(next + options.length) % options.length]?.focus();
                }}
                className="mt-2 max-h-56 overflow-y-auto rounded-[5px] border border-border"
            >{projectOptions.length ? projectOptions.map((project) => <button key={project.id} type="button" role="option" aria-selected={project.id === selectedProjectId} onClick={() => { setSelectedProjectId(project.id); setIsChoosingProject(false); setFormError(null); }} className={`flex w-full items-center justify-between gap-3 rounded-[5px] px-3 py-2 text-left text-sm transition-colors ${project.id === selectedProjectId ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted text-foreground"}`}><span className="truncate">{project.title}</span>{project.id === selectedProjectId ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}</button>) : <p className="px-3 py-2 text-sm text-muted-foreground">No eligible workspaces available.</p>}</div></div> : null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && closeComposer("dismissed")}>
            <DialogContent
                presentation={phone ? "bottom-sheet" : "center"}
                // After a submit the button the dialog opened from is disabled, so focus goes to the status line that replaced it.
                onCloseAutoFocus={(event) => {
                    if (!completedRef.current) return;
                    event.preventDefault();
                    document.getElementById("open-roles-status")?.focus();
                }}
                className={phone ? "gap-0 overflow-hidden border border-border bg-card p-0 text-foreground" : "sm:max-w-[550px] gap-0 overflow-hidden rounded-[12px] border border-border bg-card p-0 text-foreground shadow-lg"}
            >
                <DialogHeader className="border-b border-border px-6 py-4 text-left">
                    <DialogTitle className={plainContentHeadings ? "nb-card-title text-foreground" : "nb-card-title flex items-center gap-2 text-foreground"}>
                        {!plainContentHeadings && (mode === "apply" ? <Briefcase aria-hidden="true" className="size-5 text-primary" /> : <Users aria-hidden="true" className="size-5 text-primary" />)}
                        {mode === "apply" ? (isEditing ? "Edit application" : "Apply for a role") : "Invite members"}
                    </DialogTitle>
                </DialogHeader>

                <div className={phone ? "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" : "max-h-[68dvh] space-y-4 overflow-y-auto px-6 py-5"}>
                    {formError ? <div role="alert" className="flex gap-2 rounded-[5px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{formError}</div> : null}

                    <div className="relative">
                        {selectedProjectContext}
                        {projectPicker}
                    </div>

                    {mode === "invite" && !candidateIsFixed && selectedProjectId ? <div className="space-y-2">{step("Select person")}<label className="sr-only" htmlFor="recruitment-person-search">Search people</label>{!selectedCandidate ? <><div className="relative"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input ref={searchInputRef} id="recruitment-person-search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setFormError(null); }} placeholder="Search connections or people…" className="w-full rounded-[5px] border border-border bg-muted/30 py-2 pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" /></div><div role="status" aria-live="polite" className="sr-only">{searching ? "Searching people." : `${people.length} eligible ${people.length === 1 ? "person" : "people"} found.`}</div><div aria-busy={loadingOptions || searching} className="h-[230px] overflow-hidden rounded-[5px] border border-border">{loadingOptions || searching ? <div className="flex h-full items-center justify-center"><Loader2 aria-label="Loading people" className="size-5 animate-spin text-primary" /></div> : people.length === 0 ? <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">{searchQuery.trim().length === 1 ? "Type at least two characters to search people." : "No eligible people found."}</div> : <Virtuoso style={{ height: 230 }} data={people} itemContent={(_, candidate) => <button type="button" onClick={() => selectCandidate(candidate)} aria-label={`Select ${displayName(candidate)}`} className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-muted"><UserAvatar identity={candidate} size={34} roundedClassName="rounded-[5px]" fallbackClassName="font-mono text-xs" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{displayName(candidate)} {candidate.username && candidate.fullName ? <span className="font-normal text-muted-foreground">@{candidate.username}</span> : null}</span><span className="block truncate text-xs text-muted-foreground">{candidate.headline || ""}</span></span>{candidate.state === "application_pending" ? <span className="rounded-[3px] border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">APPLIED</span> : null}{candidate.state === "invitation_pending" ? <span className="rounded-[3px] border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300">INVITED</span> : null}</button>} />}</div></> : <div className="flex items-center justify-between rounded-[5px] border border-border bg-muted/30 p-3 text-foreground"><span className="text-sm font-medium">Candidate: {displayName(selectedCandidate)}</span><Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedCandidate(null); setFormError(null); window.requestAnimationFrame(() => searchInputRef.current?.focus()); }}>Change</Button></div>}</div> : null}

                    {(mode === "apply" || selectedCandidate) && selectedProjectId ? <>
                        {mode === "invite" ? <div className="space-y-2">{step("Invite as")}<label className="sr-only" htmlFor="recruitment-invite-kind">Invitation type</label><select id="recruitment-invite-kind" value={inviteKind} onChange={(event) => { setInviteKind(event.target.value as InvitationKind); setFormError(null); }} className="w-full rounded-[5px] border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary"><option value="ordinary_role">Open role</option>{canAppointSelectedGuidance ? <option value="guidance_appointment">Invite as mentor</option> : null}</select></div> : null}

                        {mode === "invite" && inviteKind === "guidance_appointment" ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="recruitment-guidance-label" className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Mentor focus</label><input ref={guidanceLabelRef} id="recruitment-guidance-label" value={guidanceLabel} onChange={(event) => setGuidanceLabel(event.target.value.slice(0, 60))} maxLength={60} className="w-full rounded-[5px] border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" /></div><div className="space-y-2"><label htmlFor="recruitment-review-date" className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Review date <span className="normal-case font-normal">(optional)</span></label><input id="recruitment-review-date" type="date" value={reviewAt} onChange={(event) => setReviewAt(event.target.value)} className="w-full rounded-[5px] border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" /></div></div>{guidanceLoading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Checking mentor availability…</p> : guidancePreflight?.activeGuide ? <div className="rounded-[5px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{guidancePreflight.activeGuide.label}: {guidancePreflight.activeGuide.name} is already a mentor here.</div> : guidancePreflight?.capacity === "blocked" ? <div className="rounded-[5px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">This person has reached their mentor limit.</div> : guidancePreflight?.capacity === "warning" ? <div className="rounded-[5px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">This person is close to their mentor limit.</div> : <p className="text-xs text-muted-foreground">When they accept, they become an admin of this workspace.</p>}</div> : <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label htmlFor="recruitment-role" className="nb-ui-label block text-[13px] font-medium text-foreground">
                                    {mode === "apply" ? "Select role" : "Assign role"}
                                </label>
                                <select
                                    ref={roleSelectRef}
                                    id="recruitment-role"
                                    value={roleId}
                                    onChange={(event) => { setRoleId(event.target.value); setFormError(null); }}
                                    disabled={selectableRoles.length === 0}
                                    className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                >
                                    <option value="">{selectableRoles.length ? "Select a role" : "No open roles available"}</option>
                                    {selectableRoles.map((role) => (
                                        <option key={role.id} value={role.id}>
                                            {roleLabel(role)} ({remainingRoles(role)} spot{remainingRoles(role) === 1 ? "" : "s"} left)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {selectedRole ? (
                                <div className="space-y-3 rounded-[6px] border border-border bg-muted/20 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="nb-ui-label text-sm font-semibold text-foreground">
                                            {roleLabel(selectedRole)}
                                        </span>
                                        <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                            {remainingRoles(selectedRole)} {remainingRoles(selectedRole) === 1 ? "1 open" : "2 open"}
                                        </span>
                                    </div>
                                    {selectedRole.description ? (
                                        <div className="space-y-1">
                                            <p className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Role description</p>
                                            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
                                                {selectedRole.description}
                                            </p>
                                        </div>
                                    ) : null}
                                    {selectedRole.skills && selectedRole.skills.length > 0 ? (
                                        <div className="space-y-1.5">
                                            <p className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Required skills</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {selectedRole.skills.map((skill) => (
                                                    <span
                                                        key={skill}
                                                        className="inline-flex items-center rounded-[3px] border border-border bg-card px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-foreground/90 shadow-none"
                                                    >
                                                        {skill}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>}

                        {mode === "invite" && hasPendingApplication ? <div className="flex gap-2 rounded-[5px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Review this person’s existing application instead of sending a separate invitation.</div> : null}{mode === "invite" && hasPendingInvitation ? <div className="flex gap-2 rounded-[5px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />An invitation is already pending for this person.</div> : null}
                        {mode === "invite" && alignment && inviteKind === "ordinary_role" ? <div className="grid grid-cols-3 gap-2 rounded-[5px] border border-border bg-muted/30 p-3 text-xs text-muted-foreground"><span className="flex items-center gap-1">{alignment.commitmentMatch.aligns ? <Check aria-hidden="true" className="size-3 text-[var(--status-success,#2F6B4F)]" /> : null}Commitment</span><span className="flex items-center gap-1">{alignment.capacityMatch.aligns ? <Check aria-hidden="true" className="size-3 text-[var(--status-success,#2F6B4F)]" /> : null}Capacity</span><span className="flex items-center gap-1">{alignment.experienceMatch.aligns ? <Check aria-hidden="true" className="size-3 text-[var(--status-success,#2F6B4F)]" /> : null}Experience</span></div> : null}

                        {mode === "invite" ? <div className="space-y-2">{step("Message (optional)")}<label className="sr-only" htmlFor="recruitment-note">Message (optional)</label><textarea id="recruitment-note" value={note} onChange={(event) => setNote(event.target.value.slice(0, NOTE_LIMIT))} rows={4} maxLength={NOTE_LIMIT} placeholder="Add a message…" className="w-full resize-none rounded-[5px] border border-border bg-card p-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" /><p className="text-right text-xs text-muted-foreground">{note.length}/{NOTE_LIMIT}</p></div> : <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label htmlFor="recruitment-application-message" className="nb-ui-label block text-[13px] font-medium text-foreground">
                                    Why you’re a good fit <span aria-hidden="true" className="text-destructive">*</span>
                                    <span className="sr-only"> (required)</span>
                                </label>
                                <textarea
                                    ref={applicationMessageRef}
                                    id="recruitment-application-message"
                                    value={applicationMessage}
                                    onChange={(event) => setApplicationMessage(event.target.value.slice(0, APPLICATION_LIMIT))}
                                    rows={5}
                                    maxLength={APPLICATION_LIMIT}
                                    required
                                    aria-required="true"
                                    aria-describedby="recruitment-application-hint recruitment-application-count"
                                    placeholder="Your relevant skills and how you’d get started."
                                    className="w-full resize-none rounded-[5px] border border-border bg-card p-3 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span id="recruitment-application-hint">{applicationMessage.trim().split(/\s+/).filter(Boolean).length < 12 ? "Add a short intro, your relevant skills and how you’d help." : ""}</span>
                                    <span id="recruitment-application-count" aria-live="polite">{applicationMessage.length}/{APPLICATION_LIMIT}{applicationMessage.length >= APPLICATION_LIMIT ? " · limit reached" : ""}</span>
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label htmlFor="recruitment-portfolio" className="nb-ui-label block text-[13px] font-medium text-foreground">
                                        Portfolio link <span className="font-normal text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <input
                                        ref={portfolioRef}
                                        id="recruitment-portfolio"
                                        value={portfolioUrl}
                                        onChange={(event) => { setPortfolioUrl(event.target.value.slice(0, PORTFOLIO_LIMIT)); setPortfolioError(null); }}
                                        maxLength={PORTFOLIO_LIMIT}
                                        aria-invalid={portfolioError ? true : undefined}
                                        aria-describedby={portfolioError ? "recruitment-portfolio-error" : undefined}
                                        placeholder="https://…"
                                        className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary aria-[invalid=true]:border-destructive"
                                    />
                                    {portfolioError ? <p id="recruitment-portfolio-error" className="text-xs text-destructive">{portfolioError}</p> : null}
                                </div>
                                <div className="space-y-1.5">
                                    <label htmlFor="recruitment-availability" className="nb-ui-label block text-[13px] font-medium text-foreground">
                                        Availability <span className="font-normal text-xs text-muted-foreground">(optional)</span>
                                    </label>
                                    <input
                                        id="recruitment-availability"
                                        value={availability}
                                        onChange={(event) => setAvailability(event.target.value.slice(0, AVAILABILITY_LIMIT))}
                                        maxLength={AVAILABILITY_LIMIT}
                                        placeholder="e.g. 15 h/week"
                                        className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Submitting opens a private conversation with the workspace\u2019s reviewers (its owner and admins). They are notified, and their answer shows up there and in your notifications.
                            </p>
                        </div>}
                    </> : null}
                </div>

                <DialogFooter className="flex items-center justify-end gap-2.5 border-t border-border bg-muted/10 px-4 py-3.5 sm:px-6">
                    {submitBlocker ? <p id="recruitment-submit-hint" className="mr-auto min-w-0 text-xs text-muted-foreground">{submitBlocker}</p> : null}
                    <Button type="button" variant="outline" onClick={() => closeComposer("cancelled")} disabled={submitting} className="nb-touch-target h-[34px] rounded-[5px] border-border text-foreground hover:bg-muted">Cancel</Button>
                    <Button
                        type="button"
                        // Apply mode keeps the button reachable (aria-disabled) so its reason is read; submit() answers a blocked click with the same reason.
                        onClick={mode === "apply" && submitBlocker ? () => showError(submitBlocker, !roleId ? roleSelectRef : applicationMessageRef) : submit}
                        aria-describedby={submitBlocker ? "recruitment-submit-hint" : undefined}
                        aria-disabled={mode === "apply" ? Boolean(submitBlocker) || undefined : undefined}
                        disabled={submitting || (mode === "apply" ? false : !selectedProject || !selectedCandidate || hasPendingApplication || hasPendingInvitation || (inviteKind === "ordinary_role" && !roleId) || (inviteKind === "guidance_appointment" && (!guidanceLabel.trim() || guidanceLoading || guidanceUnavailable)))} className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] aria-disabled:cursor-not-allowed aria-disabled:opacity-60">{submitting ? <Loader2 aria-label="Submitting" className="size-4 animate-spin" /> : null}{submitting ? "Sending..." : mode === "apply" ? (isEditing ? "Save changes" : "Submit application") : "Send invitation"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
