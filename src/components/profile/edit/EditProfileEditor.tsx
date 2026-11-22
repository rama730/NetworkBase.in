"use client";

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, Pencil } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";

import { saveProfileContributionsAction } from "@/app/actions/profile-contributions";
import { updateProfileAction } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useRouter, useSearchParams } from "next/navigation";
import { completionField, completionItemSection, parseProfileEditSection, profileEditHref, profileEditReturnHref } from "@/lib/profile/edit-route";
import { calculateProfileCompletion } from "@/lib/validations/profile";
import { changeSummary, localDraft, mergeConflict, normalizeWebsite, websiteError } from "@/lib/profile/mix";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { shareOrigin } from "@/lib/sharing/presentation";

const usernameHost = (() => { try { return new URL(shareOrigin()).host; } catch { return "networkbase.in"; } })();
import { experienceLevelLabel, weeklyCapacityLabel } from "@/lib/profile/role-preferences";
import { ProfileBand } from "@/components/profile/v2/ProfileBand";
import { ChangesCard, PhoneSaveBar, type ProfileChange } from "./ChangesCard";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import { useAuth } from "@/hooks/use-auth";
import {
    buildContributionMutations,
    contributionEntryChanged,
    contributionToEditorEntry,
    type ContributionEditorEntry,
    validateContributionEditorEntry,
} from "@/lib/profile/contribution-editor";
import type { ProfileCollaborationContribution, ProfileCollaborationSummary } from "@/lib/profile/collaboration";
import {
    loadProfileContributionsPage,
    loadProfileContributionWindow,
} from "@/lib/profile/browser-profile";
import { applyPayloadToFormBase, mergeSocialLinkCollections, socialLinkItemsFromStorage, toFormState, toChangedServerPayload } from "@/lib/profile/normalization";
import { queryKeys } from "@/lib/query-keys";
import { EditProfileTabs, type EditProfileSection } from "./EditProfileTabs";
import { useBack } from "@/hooks/useBack";

interface EditProfileEditorProps {
    profile: any;
    contributions?: ProfileCollaborationContribution[];
    /** The profile's own summary, for Preview full profile. */
    collaborationSummary?: ProfileCollaborationSummary;
    onOptimisticUpdate?: (updates: any) => void;
    initialSection?: EditProfileSection;
    onSaved?: (updatedAt: string, contributionsChanged: boolean) => Promise<void> | void;
    /** While the last username change is under 30 days old: when the next one is allowed. */
    usernameNextChangeAt?: string | null;
}

type SaveState = "idle" | "saving" | "success" | "error";

function toIsoTimestamp(value: unknown): string {
    if (typeof value === "string" && value.trim()) return value;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    return new Date().toISOString();
}

function withContributionEntries(profile: any, contributions: readonly ProfileCollaborationContribution[]) {
    const normalized = toFormState(profile) as any;
    const entries = contributions.map(contributionToEditorEntry);
    normalized.experience = entries;
    normalized.contributionBase = entries;
    return normalized;
}

function formFieldsChanged(current: Record<string, unknown> | null, base: Record<string, unknown> | null) {
    if (!current || !base) return false;
    if (current.openToCollaborate !== base.openToCollaborate) return true;
    const trackedKeys = [
        "fullName",
        "username",
        "headline",
        "bio",
        "location",
        "website",
        "avatarUrl",
        "bannerUrl",
        "experienceLevel",
        "hoursPerWeek",
        "genderIdentity",
        "pronouns",
    ];
    for (const key of trackedKeys) {
        const curVal = (current[key] ?? "").toString().trim();
        const baseVal = (base[key] ?? "").toString().trim();
        if (curVal !== baseVal) return true;
    }

    const arrayKeys = ["skills", "interests", "openTo", "openToCustomRoles", "preferredCategories"];
    for (const key of arrayKeys) {
        const curArr = Array.isArray(current[key]) ? current[key] : [];
        const baseArr = Array.isArray(base[key]) ? base[key] : [];
        if (curArr.length !== baseArr.length) return true;
        for (let i = 0; i < curArr.length; i++) {
            if (JSON.stringify(curArr[i]) !== JSON.stringify(baseArr[i])) return true;
        }
    }

    if (JSON.stringify(current.socialLinks ?? {}) !== JSON.stringify(base.socialLinks ?? {})) return true;

    return false;
}

/** Every saved field: its name in the Changes card and the section that holds it. */
const PROFILE_FIELDS: Array<[key: string, label: string, section: EditProfileSection]> = [
    ["avatarUrl", "Photo", "general"], ["fullName", "Name", "general"], ["username", "Username", "general"], ["headline", "Headline", "general"],
    ["bio", "About", "general"], ["location", "Location", "general"], ["website", "Website", "general"], ["genderIdentity", "Gender", "general"],
    ["pronouns", "Pronouns", "general"], ["skills", "Skills", "skills"], ["interests", "Interests", "skills"], ["socialLinks", "Links", "social"],
    ["openToCollaborate", "Open to collaborate", "opportunity"], ["openTo", "Role types", "opportunity"], ["preferredCategories", "Categories", "opportunity"],
    ["openToCustomRoles", "Roles", "opportunity"], ["experienceLevel", "Experience", "opportunity"], ["hoursPerWeek", "Weekly availability", "opportunity"],
];

/** The field a change row, a preview part or a checklist item opens. */
const FIELD_ELEMENT: Record<string, string> = {
    name: "profile-full-name", fullName: "profile-full-name", username: "profile-username", headline: "profile-headline", bio: "profile-bio",
    location: "profile-location", website: "profile-website", pronouns: "profile-pronouns", links: "profile-social-url", socialLinks: "profile-social-url",
    open: "open-to-collaborate-switch", openToCollaborate: "open-to-collaborate-switch", photo: "profile-photo-button", avatarUrl: "profile-photo-button",
    skills: "profile-skills",
};
const FIELD_SECTION: Record<string, EditProfileSection> = { links: "social", open: "opportunity", photo: "general", name: "general", skills: "skills" };

// The whole profile, drawn from the draft; loaded only when you ask for it.
const ProfileV2Client = lazy(() => import("@/components/profile/v2/ProfileV2Client").then((m) => ({ default: m.ProfileV2Client })));
const SELF = { canViewProfile: true, canSendMessage: false, canSendConnectionRequest: false, blockedByViewer: false, blockedByTarget: false, visibilityReason: "self", connectionState: "none" } as const;
const draftKey = (profileId: string) => `nb:profile-edit:${profileId}`;
const agoText = (at: number) => { const m = Math.round((Date.now() - at) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago`; };
const norm = (value: unknown) => typeof value === "string" ? value.trim() : value ?? null;
const sameValue = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const linkNames = (value: unknown) => socialLinkItemsFromStorage(value ?? {}).map((link) => link.label || link.platform || link.url);

function summarize(key: string, before: any, after: any): string {
    if (key === "avatarUrl") return changeSummary("photo", before ? "photo" : "pixel", after ? "new" : "pixel");
    if (key === "socialLinks") return changeSummary(key, linkNames(before), linkNames(after)).replace(/^Reordered$/, "Edited");
    if (key === "experienceLevel" && after) return experienceLevelLabel(after) ?? "Edited";
    if (key === "hoursPerWeek" && after) return weeklyCapacityLabel(after) ?? "Edited";
    if ((key === "experienceLevel" || key === "hoursPerWeek" || key === "genderIdentity") && !after) return "Cleared";
    return changeSummary(key, before ?? "", after ?? "");
}

export function EditProfileEditor({
    profile,
    contributions = [],
    collaborationSummary,
    onOptimisticUpdate,
    initialSection = "general",
    onSaved,
    usernameNextChangeAt = null,
}: EditProfileEditorProps) {
    const queryClient = useQueryClient();
    const { refreshProfile, user } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const sectionFromUrl = parseProfileEditSection(searchParams.get("section") ?? initialSection);
    const returnHref = profileEditReturnHref(searchParams.get("returnTab"));
    const [formState, setFormState] = useState<any>(null);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
    // Fields changed both here and in another tab, with the other tab's value; you pick per field.
    const [clashes, setClashes] = useState<Record<string, unknown>>({});
    // A draft left unsaved earlier (this browser only), offered once on open.
    const [recover, setRecover] = useState<{ at: number; d: Record<string, unknown> } | null>(null);
    const [contributionErrors, setContributionErrors] = useState<Record<string, string>>({});
    const [contributionHasMore, setContributionHasMore] = useState(false);
    const [contributionTotal, setContributionTotal] = useState(contributions.length);
    const [contributionsLoadingMore, setContributionsLoadingMore] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [activeSection, setActiveSection] = useState<EditProfileSection>(initialSection);
    const [savedLabel, setSavedLabel] = useState("Everything is saved");
    const [showWebsiteError, setShowWebsiteError] = useState(false);
    const [askUsername, setAskUsername] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const inFlightRef = useRef(false);
    const [initialData] = useState(() => ({ profile, contributions, section: sectionFromUrl }));
    const draftTouchedRef = useRef(false);
    const openGenerationRef = useRef(0);
    const lastKnownUpdatedAtRef = useRef(toIsoTimestamp(profile?.updatedAt));
    const baseProfileRef = useRef<any>(withContributionEntries(profile, contributions));
    const originalUsernameRef = useRef<string>(toFormState(profile).username || "");

    const hasChanges = useMemo(() => {
        if (!formState || !baseProfileRef.current) return false;
        const base = baseProfileRef.current as Record<string, unknown>;
        const contributionChanges = buildContributionMutations(
            (base.contributionBase ?? []) as ContributionEditorEntry[],
            (formState.experience ?? []) as ContributionEditorEntry[],
        );
        return formFieldsChanged(formState, base) || contributionChanges.length > 0;
    }, [formState]);

    // What is unsaved, one row per field, plus one row for contribution edits, which share Save.
    const changes = useMemo<ProfileChange[]>(() => {
        if (!formState || !baseProfileRef.current) return [];
        const base = baseProfileRef.current as any;
        const rows: ProfileChange[] = PROFILE_FIELDS.filter(([key]) => !sameValue(formState[key], base[key]))
            .map(([key, label, section]) => ({ key, label, section, field: key, summary: summarize(key, base[key], formState[key]) }));
        const edits = buildContributionMutations((base.contributionBase ?? []) as ContributionEditorEntry[], (formState.experience ?? []) as ContributionEditorEntry[]).length;
        if (edits) rows.push({ key: "experience", label: "Contributions", section: "experience", field: "experience", summary: `${edits} edited` });
        return rows;
    }, [formState]);
    // Keep unsaved fields in this browser so a reload or a crash doesn't lose them; saved or reset, it goes.
    useEffect(() => {
        if (!formState || recover || !profile?.id) return;
        const base = baseProfileRef.current as any;
        const d = localDraft(formState, base, PROFILE_FIELDS.map(([key]) => key));
        try {
            if (Object.keys(d).length) window.localStorage.setItem(draftKey(profile.id), JSON.stringify({ at: Date.now(), d }));
            else window.localStorage.removeItem(draftKey(profile.id));
        } catch { /* private mode or full storage: the draft just isn't kept */ }
    }, [formState, recover, profile?.id]);
    const dirtySections = useMemo(() => new Set(changes.map((change) => change.section)), [changes]);
    const completion = useMemo(() => formState ? calculateProfileCompletion({
        avatarUrl: formState.avatarUrl, fullName: formState.fullName?.trim(), username: formState.username, headline: formState.headline?.trim(),
        bio: formState.bio?.trim(), location: formState.location?.trim(), website: formState.website?.trim(), skills: formState.skills ?? [], socialLinks: formState.socialLinks ?? {},
    }) : { score: 0, missing: [] }, [formState]);
    const usernameCheck = useUsernameAvailability({ value: formState?.username ?? "", currentUsername: originalUsernameRef.current, debounceMs: 500 });
    // Hard stops turn Save off; a bad website leaves Save on and takes you to the field.
    const hardBlock = !formState ? null
        : Object.keys(clashes).length ? "Pick a version for each field changed in another tab."
        : String(formState.avatarUrl ?? "").startsWith("blob:") ? "Wait for the photo to finish uploading."
        : !String(formState.fullName ?? "").trim() ? "Add your name before saving."
            : !String(formState.username ?? "").trim() || usernameCheck.status === "invalid" ? "Pick another username before saving."
                : usernameCheck.status === "checking" ? "Checking your username…"
                    : !user || user.id !== profile.id ? "Sign in to the account that owns this profile before saving." : null;
    const websiteBad = Boolean(formState && websiteError(String(formState.website ?? "")));
    const blockReason = hardBlock ?? (websiteBad && showWebsiteError ? "Fix the website address before saving." : null);

    useEffect(() => {
        const { profile, contributions, section } = initialData;
        if (!profile?.id) return;

        openGenerationRef.current += 1;
        const generation = openGenerationRef.current;
        draftTouchedRef.current = false;
        const initial = withContributionEntries(profile, contributions);
        baseProfileRef.current = initial;
        originalUsernameRef.current = initial.username || "";
        lastKnownUpdatedAtRef.current = toIsoTimestamp(profile.updatedAt);
        setFormState(initial);
        setSaveState("idle");
        setClashes({});
        setSaveErrorMessage(null);
        setContributionErrors({});
        setContributionHasMore(false);
        setContributionTotal(contributions.length);
        setContributionsLoadingMore(true);
        setShowDiscardConfirm(false);
        setActiveSection(section);
        try {
            const stored = JSON.parse(window.localStorage.getItem(draftKey(profile.id)) ?? "null");
            const d = stored && typeof stored.d === "object" ? Object.fromEntries(Object.entries(stored.d as Record<string, unknown>).filter(([key, value]) => PROFILE_FIELDS.some(([k]) => k === key) && !sameValue(value, (initial as any)[key]))) : {};
            setRecover(Object.keys(d).length ? { at: Number(stored.at) || Date.now(), d } : null);
        } catch { setRecover(null); }

        void loadProfileContributionsPage(profile.id, { limit: 50, offset: 0, stageLimit: 20 })
            .then((page) => {
                if (openGenerationRef.current !== generation) return;
                setContributionTotal(page.total);
                const incoming = page.contributions.map(contributionToEditorEntry);
                baseProfileRef.current = {
                    ...baseProfileRef.current,
                    experience: incoming,
                    contributionBase: incoming,
                };
                setFormState((prev: any) =>
                    prev
                        ? {
                              ...prev,
                              experience: incoming,
                              contributionBase: incoming,
                          }
                        : prev,
                );
                setContributionHasMore(page.hasMore && page.contributions.length < 500);
            })
            .catch((error) => {
                if (openGenerationRef.current !== generation) return;
                const message = error instanceof Error ? error.message : "Couldn’t load all workspace contributions";
                setSaveErrorMessage(message);
                toast.error(feedbackError(message, "Action couldn’t finish"));
            })
            .finally(() => {
                if (openGenerationRef.current === generation) setContributionsLoadingMore(false);
            });
        return () => { openGenerationRef.current += 1; };
    }, [initialData]);

    const applyOptimisticPatch = (payload: Record<string, unknown>) => {
        if (!onOptimisticUpdate) return;
        onOptimisticUpdate({
            fullName: payload.fullName,
            username: payload.username,
            headline: payload.headline,
            bio: payload.bio,
            location: payload.location,
            website: payload.website,
            avatarUrl: payload.avatarUrl,
            bannerUrl: payload.bannerUrl,
            skills: payload.skills,
            socialLinks: payload.socialLinks,
            openTo: payload.openTo,
            openToCollaborate: payload.openToCollaborate,
            openToCustomRoles: payload.openToCustomRoles,
            preferredCategories: payload.preferredCategories,
            experienceLevel: payload.experienceLevel,
            hoursPerWeek: payload.hoursPerWeek,
        });
    };

    const invalidateProfileReads = (payload: Record<string, unknown>) => {
        const targets = new Set<string>([
            profile?.id || "",
            profile?.username || "",
            (payload.username as string | undefined) || "",
        ]);
        targets.forEach((target) => {
            if (target) void queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(target) });
        });
        if (profile?.id) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.profile.collaborationSummary(profile.id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.profile.projects(profile.id) });
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.networkRoot(), refetchType: "active" });
        void queryClient.invalidateQueries({ queryKey: queryKeys.connections.root() });
    };

    const { allowLeave, leaveDialog } = useLeaveGuard(hasChanges, saveState === "saving");
    // A real back to where you were (unified back §9). Saving already revalidates the profile pages,
    // so going back shows the change; everything else stays as you left it.
    const back = useBack(returnHref);
    const onClose = () => {
        allowLeave();
        back();
    };

    useEffect(() => { setActiveSection(sectionFromUrl); }, [sectionFromUrl]);

    const persistChanges = async (draft: any = formState) => {
        if (!draft || !hasChanges || inFlightRef.current) return;
        if (draft !== formState) setFormState(draft);
        if (!user || user.id !== profile.id) {
            setSaveErrorMessage("Sign in to the account that owns this profile before saving.");
            return;
        }
        const base = baseProfileRef.current as any;
        const currentEntries = (draft.experience ?? []) as ContributionEditorEntry[];
        const originalEntries = (base.contributionBase ?? []) as ContributionEditorEntry[];
        const originalEntriesById = new Map(originalEntries.map((entry) => [entry.draftId, entry]));
        const validationErrors = Object.fromEntries(
            currentEntries.flatMap((entry) => {
                if (!contributionEntryChanged(entry, originalEntriesById.get(entry.draftId))) return [];
                const error = validateContributionEditorEntry(entry);
                return error ? [[entry.draftId, error] as const] : [];
            }),
        );
        if (Object.keys(validationErrors).length > 0) {
            setContributionErrors(validationErrors);
            setActiveSection("experience");
            setSaveState("error");
            setSaveErrorMessage("Fix the highlighted workspace contribution before saving");
            toast.error("Fix the highlighted workspace contribution before saving");
            return;
        }

        inFlightRef.current = true;
        setSaveState("saving");
        setSaveErrorMessage(null);
        setContributionErrors({});

        const profilePayload = toChangedServerPayload(draft, base, lastKnownUpdatedAtRef.current);
        const mutations = buildContributionMutations(
            originalEntries,
            currentEntries,
        );
        const shouldSaveProfile = formFieldsChanged(draft, base);
        const rollbackPatch: Record<string, unknown> = {};
        let profileSaved = false;

        try {
            if (shouldSaveProfile) {
                for (const key of Object.keys(profilePayload)) {
                    if (key !== "expectedUpdatedAt" && key in base) rollbackPatch[key] = base[key];
                }
                applyOptimisticPatch(profilePayload);
                const response = await updateProfileAction(profilePayload as any);
                if (!response.success) {
                    applyOptimisticPatch(rollbackPatch);
                    const code = (response as any).errorCode || (response as any).code;
                    const changedKeys = Object.keys(profilePayload).filter((key) => key !== 'expectedUpdatedAt' && JSON.stringify(profilePayload[key] ?? null) !== JSON.stringify(base[key] ?? null));
                    if (code === 'PROFILE_CONFLICT' && changedKeys.length === 1 && changedKeys[0] === 'socialLinks' && (response as any).currentSocialLinks !== undefined) {
                        const mergedLinks = mergeSocialLinkCollections(base.socialLinks, draft.socialLinks, (response as any).currentSocialLinks);
                        baseProfileRef.current = { ...baseProfileRef.current, socialLinks: (response as any).currentSocialLinks };
                        setFormState((current: any) => current ? { ...current, socialLinks: mergedLinks } : current);
                        lastKnownUpdatedAtRef.current = typeof (response as any).updatedAt === 'string' ? (response as any).updatedAt : lastKnownUpdatedAtRef.current;
                        throw new Error('Your latest saved links were merged with this draft. Review them and save again.');
                    }
                    if (code === "PROFILE_CONFLICT" && response.currentProfile && response.updatedAt) {
                        // What only the other tab changed comes in; what you both changed differently is yours to pick.
                        const theirs = toFormState(response.currentProfile) as any;
                        const keys = PROFILE_FIELDS.map(([key]) => key);
                        const result = mergeConflict(base, draft, theirs, keys);
                        baseProfileRef.current = { ...base, ...Object.fromEntries(keys.map((key) => [key, theirs[key]])) };
                        originalUsernameRef.current = theirs.username || "";
                        lastKnownUpdatedAtRef.current = response.updatedAt;
                        setFormState({ ...draft, ...result.merged });
                        setClashes(result.clashes);
                        throw new Error(Object.keys(result.clashes).length ? "Changed in another tab. Pick a version below." : "Merged with changes from another tab. Review and save again.");
                    }
                    throw new Error(code === "PROFILE_CONFLICT" ? "Your profile changed in another session. Reload to see it, then save again." : ((response as any).error || "Couldn’t update profile"));
                }
                lastKnownUpdatedAtRef.current = typeof (response as any).updatedAt === "string"
                    ? (response as any).updatedAt
                    : lastKnownUpdatedAtRef.current;
                baseProfileRef.current = applyPayloadToFormBase(baseProfileRef.current, profilePayload);
                profileSaved = true;
            }

            if (mutations.length > 0) {
                const result = await saveProfileContributionsAction({
                    idempotencyKey: crypto.randomUUID(),
                    mutations,
                });
                if (!result.success) {
                    const failedMutation = result.mutationIndex === undefined
                        ? undefined
                        : mutations[result.mutationIndex];
                    const failedEntry = ((draft.experience ?? []) as ContributionEditorEntry[]).find((entry) =>
                        (result.contributionId && entry.contributionId === result.contributionId)
                        || (failedMutation?.kind === "external" && entry.externalKey === failedMutation.externalKey),
                    );
                    if (failedEntry) {
                        setContributionErrors({ [failedEntry.draftId]: result.error });
                    }
                    throw new Error(result.error);
                }
            }

            const loadedCount = Math.max(
                ((draft.experience ?? []) as ContributionEditorEntry[]).length,
                1,
            );
            const freshWindow = mutations.length > 0 && profile?.id
                ? await loadProfileContributionWindow(profile.id, loadedCount)
                : { contributions: [], total: contributionTotal, hasMore: contributionHasMore };
            const freshEntries = mutations.length > 0 ? freshWindow.contributions.map(contributionToEditorEntry) : currentEntries;
            const nextBase = {
                ...baseProfileRef.current,
                experience: freshEntries,
                contributionBase: freshEntries,
            };
            baseProfileRef.current = nextBase;
            setFormState(nextBase);
            setContributionErrors({});
            setContributionTotal(freshWindow.total);
            setContributionHasMore(freshWindow.hasMore && freshEntries.length < 500);
            draftTouchedRef.current = false;
            setSaveState("success");
            setSavedLabel("Saved just now");
            invalidateProfileReads(profilePayload);
            void refreshProfile().catch(() => undefined);
            await onSaved?.(lastKnownUpdatedAtRef.current, mutations.length > 0);
        } catch (error) {
            if (profileSaved) {
                invalidateProfileReads(profilePayload);
                void refreshProfile().catch(() => undefined);
            }
            const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred while saving your profile.";
            const message = profileSaved && mutations.length > 0
                ? `Profile details were saved, but contributions were not: ${errorMessage}`
                : errorMessage;
            setSaveState("error");
            setSaveErrorMessage(message);
            toast.error(feedbackError(message, "Action couldn’t finish"));
        } finally {
            inFlightRef.current = false;
        }
    };

    const handleLoadMoreContributions = async () => {
        if (!profile?.id || contributionsLoadingMore || !contributionHasMore) return;
        const generation = openGenerationRef.current;
        const base = baseProfileRef.current as any;
        const baseEntries = (base.contributionBase ?? []) as ContributionEditorEntry[];
        setContributionsLoadingMore(true);
        try {
            const page = await loadProfileContributionsPage(profile.id, {
                limit: 50,
                offset: baseEntries.length,
                stageLimit: 20,
            });
            if (openGenerationRef.current !== generation) return;
            const incoming = page.contributions.map(contributionToEditorEntry);
            const known = new Set(baseEntries.map((entry) => entry.draftId));
            const additions = incoming.filter((entry) => !known.has(entry.draftId));
            if (additions.length > 0) {
                baseProfileRef.current = {
                    ...base,
                    experience: [...baseEntries, ...additions],
                    contributionBase: [...baseEntries, ...additions],
                };
                setFormState((current: any) => ({
                    ...current,
                    experience: [...(current?.experience ?? []), ...additions.filter((entry) =>
                        !(current?.experience ?? []).some((existing: ContributionEditorEntry) => existing.draftId === entry.draftId),
                    )],
                    contributionBase: [...baseEntries, ...additions],
                }));
            }
            setContributionTotal(page.total);
            setContributionHasMore(
                baseEntries.length + additions.length < Math.min(page.total, 500) && page.hasMore,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Couldn’t load more workspace contributions";
            setSaveErrorMessage(message);
            toast.error(feedbackError(message, "Action couldn’t finish"));
        } finally {
            if (openGenerationRef.current === generation) setContributionsLoadingMore(false);
        }
    };

    const handleImageFinalized = (avatarUrl: string, updatedAt?: string) => {
        if (updatedAt) {
            lastKnownUpdatedAtRef.current = updatedAt;
            baseProfileRef.current = { ...baseProfileRef.current, avatarUrl };
        }
    };

    const handleSectionChange = (section: EditProfileSection) => {
        setActiveSection(section);
        window.history.replaceState(window.history.state, "", profileEditHref(section, searchParams.get("returnTab") ?? "overview"));
    };

    const handleCancel = (e?: React.MouseEvent) => {
        if (inFlightRef.current) return;
        e?.preventDefault?.();
        e?.stopPropagation?.();
        if (hasChanges) {
            setShowDiscardConfirm(true);
        } else {
            onClose();
        }
    };

    const handleResetChanges = (e?: React.MouseEvent) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const draft = formState;
        setFormState(baseProfileRef.current);
        setContributionErrors({});
        draftTouchedRef.current = false;
        setShowDiscardConfirm(false);
        setSaveState("idle");
        setSaveErrorMessage(null);
        if (draft && changes.length) toast(`${changes.length} change${changes.length > 1 ? "s" : ""} reset`, { action: { label: "Undo", onClick: () => setFormState(draft) } });
    };

    const undoChange = (key: string) => {
        const base = baseProfileRef.current as any;
        setFormState((current: any) => current ? (key === "experience" ? { ...current, experience: base.contributionBase ?? [] } : { ...current, [key]: base[key] }) : current);
        setSaveState("idle");
        setSaveErrorMessage(null);
    };

    // Opens the section, then focuses the field and flashes it once.
    const jumpTo = (field: string, section: EditProfileSection = FIELD_SECTION[field] ?? PROFILE_FIELDS.find(([key]) => key === field)?.[2] ?? "general") => {
        handleSectionChange(section);
        window.setTimeout(() => {
            const el = document.getElementById(FIELD_ELEMENT[field] ?? "");
            if (!el) return;
            const target = el.matches("input, textarea, button, [tabindex]") ? el : el.querySelector<HTMLElement>("input, textarea, button");
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            target?.focus({ preventScroll: true });
            const box = el.closest<HTMLElement>("[data-pf-field]") ?? el.parentElement;
            box?.classList.remove("nb-pf-flash");
            void box?.offsetWidth;
            box?.classList.add("nb-pf-flash");
            window.setTimeout(() => box?.classList.remove("nb-pf-flash"), 1300);
        }, 60);
    };

    // A ?field= link (the profile's checklist, a change row) lands on that field once the draft is ready.
    const fieldFromUrl = searchParams.get("field");
    const jumpedRef = useRef(false);
    useEffect(() => {
        if (!formState || jumpedRef.current || !fieldFromUrl) return;
        jumpedRef.current = true;
        jumpTo(fieldFromUrl, sectionFromUrl);
    }, [formState, fieldFromUrl]);

    const saveInPlace = (usernameConfirmed = false) => {
        if (!formState) return;
        if (hardBlock) {
            // Say why and go there, rather than a Save that quietly does nothing (the phone bar, ⌘S).
            toast.warning(hardBlock);
            if (Object.keys(clashes).length) return;
            if (!String(formState.fullName ?? "").trim()) jumpTo("name");
            else if (usernameCheck.status === "invalid" || !String(formState.username ?? "").trim()) jumpTo("username");
            return;
        }
        const website = normalizeWebsite(String(formState.website ?? ""));
        if (websiteError(website)) { setShowWebsiteError(true); jumpTo("website"); return; }
        const draft = website === (formState.website ?? "") ? formState : { ...formState, website };
        if (!usernameConfirmed && !sameValue(draft.username, baseProfileRef.current?.username)) { setAskUsername(true); return; }
        void persistChanges(draft);
    };
    // "Keep @old": the username goes back, everything else saves.
    const keepUsername = () => {
        const draft = { ...formState, username: baseProfileRef.current?.username ?? "" };
        if (changes.length > 1) void persistChanges(draft);
        else { setFormState(draft); toast.message("Kept your username."); }
    };
    const saveRef = useRef(saveInPlace);
    saveRef.current = saveInPlace;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "s") return;
            event.preventDefault();
            // In a contribution's side panel ⌘S belongs to that story (it autosaves), not to the profile fields.
            if ((event.target as HTMLElement | null)?.closest?.(".nb-pf-cd")) return;
            saveRef.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const handleDiscard = (e?: React.MouseEvent) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        setFormState(baseProfileRef.current);
        setContributionErrors({});
        draftTouchedRef.current = false;
        setShowDiscardConfirm(false);
        onClose();
    };

    const pickClash = (key: string, use: "mine" | "theirs") => {
        if (use === "theirs") setFormState((current: any) => ({ ...current, [key]: clashes[key] }));
        const rest = { ...clashes };
        delete rest[key];
        setClashes(rest);
        if (!Object.keys(rest).length) { setSaveState("idle"); setSaveErrorMessage(null); }
    };
    const shown = (value: unknown) => Array.isArray(value) ? value.join(", ") || "None" : typeof value === "boolean" ? (value ? "On" : "Off") : String(value ?? "") || "Empty";
    const clashList = Object.keys(clashes).length ? (
        <div className="nb-pf-clashes">
            {Object.entries(clashes).map(([key, theirs]) => (
                <div key={key} className="nb-pf-clash">
                    <b>{PROFILE_FIELDS.find(([k]) => k === key)?.[1] ?? key}</b>
                    <p><span>Yours</span>“{shown(formState?.[key])}”</p>
                    <p><span>Other tab</span>“{shown(theirs)}”</p>
                    <div className="nb-pf-row2">
                        <Button type="button" size="sm" variant="outline" onClick={() => pickClash(key, "mine")}>Keep mine</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => pickClash(key, "theirs")}>Use theirs</Button>
                    </div>
                </div>
            ))}
        </div>
    ) : null;

    if (user && user.id !== profile.id) return <section role="alert" className="space-y-4 p-6"><p>This editor belongs to a different account. Return to your profile to continue.</p><Button onClick={() => { allowLeave(); router.replace("/my-profile"); }}>Go to my profile</Button></section>;

    return (
        <section data-profile-editor className="flex h-full min-h-0 flex-col overflow-clip bg-background text-foreground" aria-labelledby="profile-editor-title">
                <ConfirmDialog open={askUsername} onOpenChange={setAskUsername} title={`Change your username to @${formState?.username ?? ""}?`}
                    description={`Your profile link becomes ${usernameHost}/u/${formState?.username ?? ""}. You can’t change it again until ${new Date(Date.now() + 30 * 86_400_000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.`}
                    confirmLabel="Change it and save" cancelLabel={`Keep @${baseProfileRef.current?.username ?? ""}`}
                    onConfirm={() => saveInPlace(true)} onCancel={keepUsername} />
                <ConfirmDialog {...leaveDialog} title="Discard unsaved changes?" description="Your profile changes haven’t been saved." confirmLabel="Discard and leave" cancelLabel="Keep editing" variant="destructive" />
                {previewing ? (
                    <div data-scroll-root="route" className="min-h-0 flex-1 overflow-y-auto app-scroll app-scroll-y bg-background">
                        {/* Look only: nothing in here saves or navigates; the strip is the way back. */}
                        <div role="region" aria-label="Preview of your full profile" inert>
                            <Suspense fallback={<p role="status" className="nb-compact p-6">Loading preview…</p>}>
                                <ProfileV2Client
                                    profile={{ ...profile, ...formState }}
                                    stats={{ connectionsCount: profile.connectionsCount ?? 0, projectsCount: profile.projectsCount ?? 0, followersCount: 0, mutualCount: 0 } as any}
                                    isOwner
                                    currentUser={{ id: profile.id } as any}
                                    connectionStatus="none"
                                    privacyRelationship={SELF}
                                    collaborationSummary={collaborationSummary ? { ...collaborationSummary, contributions: collaborationSummary.contributions ?? contributions } : undefined}
                                />
                            </Suspense>
                        </div>
                        <div className="nb-pf-strip" role="status">
                            <span className="nb-pf-pv">Previewing unsaved changes</span>
                            <span className="k">{changes.length} not saved yet</span>
                            <Button type="button" size="sm" onClick={() => setPreviewing(false)}><Pencil className="size-3.5" aria-hidden="true" />Back to editing</Button>
                        </div>
                    </div>
                ) : null}
                <form hidden={previewing} className="flex min-h-0 flex-1 flex-col overflow-clip" onSubmit={(event) => { event.preventDefault(); saveInPlace(); }} aria-label="Edit profile form">
                    <fieldset disabled={saveState === "saving"} className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-clip">
                        <EditProfileTabs
                            profile={formState || profile}
                            contributionProfileId={profile.id}
                            contributionProfileVisibility={profile.visibility ?? "public"}
                            originalUsername={originalUsernameRef.current}
                            baseAvatarUrl={baseProfileRef.current?.avatarUrl ?? ""}
                            usernameCheck={usernameCheck}
                            usernameNextChangeAt={usernameNextChangeAt}
                            showWebsiteError={showWebsiteError}
                            section={activeSection}
                            onSectionChange={handleSectionChange}
                            onImageFinalized={handleImageFinalized}
                            contributionErrors={contributionErrors}
                            contributionsSaving={saveState === "saving"}
                            contributionsLoadingMore={contributionsLoadingMore}
                            contributionHasMore={contributionHasMore}
                            contributionTotal={contributionTotal}
                            onLoadMoreContributions={() => { void handleLoadMoreContributions(); }}
                            onChange={(updates) => {
                                draftTouchedRef.current = true;
                                setFormState(updates);
                                setContributionErrors({});
                                if (saveState !== "saving") {
                                    setSaveState("idle");
                                    setSaveErrorMessage(null);
                                }
                            }}
                            dirtySections={dirtySections}
                            notice={recover ? (
                                <div className="nb-pf-recover" role="status">
                                    <span className="nb-pf-pv">Not saved</span>
                                    <span>You have changes from {agoText(recover.at)} that weren’t saved: {Object.keys(recover.d).map((key) => PROFILE_FIELDS.find(([k]) => k === key)?.[1] ?? key).join(", ")}.</span>
                                    <span className="flex gap-2">
                                        <Button type="button" size="sm" variant="ghost" onClick={() => { setRecover(null); try { window.localStorage.removeItem(draftKey(profile.id)); } catch { /* nothing kept */ } }}>Discard</Button>
                                        <Button type="button" size="sm" onClick={() => { const d = recover.d; setRecover(null); draftTouchedRef.current = true; setFormState((current: any) => ({ ...current, ...d })); }}>Restore</Button>
                                    </span>
                                </div>
                            ) : null}
                            preview={
                                <ProfileBand
                                    profile={formState || profile}
                                    viewerId={profile.id}
                                    isOwner
                                    isAuthenticated
                                    connectionState="none"
                                    privacyRelationship={SELF}
                                    onEdit={() => undefined}
                                    onConnectPrimary={() => undefined}
                                    onMessage={() => undefined}
                                    preview={{
                                        onJump: (field) => jumpTo(field),
                                        badge: formState?.avatarUrl && formState.avatarUrl !== baseProfileRef.current?.avatarUrl ? <span className="nb-pf-new">New · not saved</span> : null,
                                        actions: <>
                                            <span className="nb-pf-pv">Preview</span>
                                            <Button type="button" size="sm" variant="outline" onClick={() => setPreviewing(true)}><Eye className="size-3.5" aria-hidden="true" />Preview full profile</Button>
                                        </>,
                                        hint: <div className="nb-pf-hint"><span>Click anything above to edit it</span><span>Updates as you type</span></div>,
                                    }}
                                />
                            }
                            tabAction={
                                <Button type="button" size="sm" onClick={() => saveInPlace()} disabled={!changes.length || saveState === "saving" || Boolean(hardBlock)}>
                                    <Check className="size-3.5" aria-hidden="true" />Save{changes.length ? ` · ${changes.length}` : ""}
                                </Button>
                            }
                            card={
                                <>
                                    {showDiscardConfirm ? (
                                        <div className="nb-pf-panel nb-pf-discard" role="group" aria-label="Discard unsaved changes?">
                                            <p className="nb-pf-state"><AlertTriangle className="size-4 shrink-0 text-[var(--status-warning)]" />Discard unsaved changes?</p>
                                            <div className="nb-pf-row2">
                                                <Button type="button" variant="ghost" onClick={() => setShowDiscardConfirm(false)}>Keep editing</Button>
                                                <Button type="button" variant="destructive" onClick={handleDiscard}>Discard</Button>
                                            </div>
                                        </div>
                                    ) : null}
                                    <ChangesCard
                                        changes={changes}
                                        state={saveState}
                                        error={saveErrorMessage}
                                        blockReason={blockReason}
                                        savedLabel={savedLabel}
                                        onJump={(section, field) => jumpTo(field, section)}
                                        onUndo={undoChange}
                                        onSave={() => saveInPlace()}
                                        onReset={() => handleResetChanges()}
                                        onCancel={() => handleCancel()}
                                        extra={clashList}
                                        contributionDrafts={((formState?.experience ?? []) as ContributionEditorEntry[]).filter((entry) => entry.contribution && !entry.contribution.publishedAt && !entry.contribution.presentation).length}
                                        onOpenDrafts={() => handleSectionChange("experience")}
                                        completion={{ score: completion.score, missing: completion.missing, jump: (item) => jumpTo(completionField(item), completionItemSection(item)) }}
                                    />
                                </>
                            }
                            phoneBar={<PhoneSaveBar changes={changes} saving={saveState === "saving"} onReset={() => handleResetChanges()} onSave={() => saveInPlace()} />}
                        />
                    </fieldset>
                </form>
        </section>
    );
}
