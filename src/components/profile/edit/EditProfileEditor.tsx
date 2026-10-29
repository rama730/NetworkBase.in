"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";

import { saveProfileContributionsAction } from "@/app/actions/profile-contributions";
import { updateProfileAction } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { parseProfileEditSection, profileEditHref, profileEditReturnHref } from "@/lib/profile/edit-route";
import { useProfileEditNavigationGuard } from "./useProfileEditNavigationGuard";
import { useAuth } from "@/hooks/use-auth";
import {
    buildContributionMutations,
    contributionEntryChanged,
    contributionToEditorEntry,
    type ContributionEditorEntry,
    validateContributionEditorEntry,
} from "@/lib/profile/contribution-editor";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import {
    loadProfileContributionsPage,
    loadProfileContributionWindow,
} from "@/lib/profile/browser-profile";
import { applyPayloadToFormBase, mergeSocialLinkCollections, toFormState, toChangedServerPayload } from "@/lib/profile/normalization";
import { queryKeys } from "@/lib/query-keys";
import { EditProfileTabs, type EditProfileSection } from "./EditProfileTabs";

interface EditProfileEditorProps {
    profile: any;
    contributions?: ProfileCollaborationContribution[];
    onOptimisticUpdate?: (updates: any) => void;
    initialSection?: EditProfileSection;
    onSaved?: (updatedAt: string, contributionsChanged: boolean) => Promise<void> | void;
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

export function EditProfileEditor({
    profile,
    contributions = [],
    onOptimisticUpdate,
    initialSection = "general",
    onSaved,
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
    const [conflictProfile, setConflictProfile] = useState<{ profile: any; updatedAt: string } | null>(null);
    const [contributionErrors, setContributionErrors] = useState<Record<string, string>>({});
    const [contributionHasMore, setContributionHasMore] = useState(false);
    const [contributionTotal, setContributionTotal] = useState(contributions.length);
    const [contributionsLoadingMore, setContributionsLoadingMore] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [activeSection, setActiveSection] = useState<EditProfileSection>(initialSection);
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
        setConflictProfile(null);
        setSaveErrorMessage(null);
        setContributionErrors({});
        setContributionHasMore(false);
        setContributionTotal(contributions.length);
        setContributionsLoadingMore(true);
        setShowDiscardConfirm(false);
        setActiveSection(section);

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

    const allowLeave = useProfileEditNavigationGuard(hasChanges, saveState === "saving");
    const onClose = () => {
        allowLeave();
        router.replace(returnHref);
        router.refresh();
    };

    useEffect(() => { setActiveSection(sectionFromUrl); }, [sectionFromUrl]);

    const persistChanges = async (closeOnSuccess: boolean) => {
        if (!formState || !hasChanges || inFlightRef.current) return;
        if (!user || user.id !== profile.id) {
            setSaveErrorMessage("Sign in to the account that owns this profile before saving.");
            return;
        }
        const base = baseProfileRef.current as any;
        const currentEntries = (formState.experience ?? []) as ContributionEditorEntry[];
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

        const profilePayload = toChangedServerPayload(formState, base, lastKnownUpdatedAtRef.current);
        const mutations = buildContributionMutations(
            originalEntries,
            currentEntries,
        );
        const shouldSaveProfile = formFieldsChanged(formState, base);
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
                        const mergedLinks = mergeSocialLinkCollections(base.socialLinks, formState.socialLinks, (response as any).currentSocialLinks);
                        baseProfileRef.current = { ...baseProfileRef.current, socialLinks: (response as any).currentSocialLinks };
                        setFormState((current: any) => current ? { ...current, socialLinks: mergedLinks } : current);
                        lastKnownUpdatedAtRef.current = typeof (response as any).updatedAt === 'string' ? (response as any).updatedAt : lastKnownUpdatedAtRef.current;
                        throw new Error('Your latest saved links were merged with this draft. Review them and save again.');
                    }
                    if (code === "PROFILE_CONFLICT" && response.currentProfile && response.updatedAt) {
                        setConflictProfile({ profile: response.currentProfile, updatedAt: response.updatedAt });
                    }
                    const message = code === "PROFILE_CONFLICT"
                        ? "Your profile changed in another session. Review the latest changes before saving again."
                        : ((response as any).error || "Couldn’t update profile");
                    throw new Error(message);
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
                    const failedEntry = ((formState.experience ?? []) as ContributionEditorEntry[]).find((entry) =>
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
                ((formState.experience ?? []) as ContributionEditorEntry[]).length,
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
            invalidateProfileReads(profilePayload);
            void refreshProfile().catch(() => undefined);
            await onSaved?.(lastKnownUpdatedAtRef.current, mutations.length > 0);
            toast.success("Profile updated");
            if (closeOnSuccess) onClose();
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
        setFormState(baseProfileRef.current);
        setContributionErrors({});
        draftTouchedRef.current = false;
        setShowDiscardConfirm(false);
        setSaveState("idle");
        setSaveErrorMessage(null);
    };

    const handleDiscard = (e?: React.MouseEvent) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        setFormState(baseProfileRef.current);
        setContributionErrors({});
        draftTouchedRef.current = false;
        setShowDiscardConfirm(false);
        onClose();
    };

    const reviewLatestChanges = () => {
        if (!conflictProfile || !formState) return;
        const draft = toChangedServerPayload(formState, baseProfileRef.current, conflictProfile.updatedAt);
        const latest = toFormState(conflictProfile.profile);
        const nextBase = { ...baseProfileRef.current, ...latest, experience: baseProfileRef.current.experience };
        baseProfileRef.current = nextBase;
        originalUsernameRef.current = latest.username;
        lastKnownUpdatedAtRef.current = conflictProfile.updatedAt;
        setFormState({ ...nextBase, ...draft, experience: formState.experience });
        setConflictProfile(null);
        setSaveState("idle");
        setSaveErrorMessage(null);
        toast.info("Latest version loaded");
    };

    const handleSave = (e?: React.MouseEvent) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        void persistChanges(true);
    };

    if (user && user.id !== profile.id) return <section role="alert" className="space-y-4 p-6"><p>This editor belongs to a different account. Return to your profile to continue.</p><Button onClick={() => { allowLeave(); router.replace("/my-profile"); }}>Go to my profile</Button></section>;

    return (
        <section data-profile-editor className="flex h-full min-h-0 flex-col overflow-clip bg-background text-foreground" aria-labelledby="profile-editor-title">
                <form className="flex min-h-0 flex-1 flex-col overflow-clip" onSubmit={(event) => { event.preventDefault(); void persistChanges(true); }} aria-label="Edit profile form">
                    <fieldset disabled={saveState === "saving"} className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-clip md:flex-row">
                        <EditProfileTabs
                            profile={formState || profile}
                            contributionProfileId={profile.id}
                            contributionProfileVisibility={profile.visibility ?? "public"}
                            onCancelContribution={() => handleCancel()}
                            showContributionExitPrompt={showDiscardConfirm}
                            originalUsername={originalUsernameRef.current}
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
                            actions={
                                <footer aria-label="Profile actions" className="w-full shrink-0 border-t border-border bg-card px-4 py-2 md:px-[calc(var(--ui-panel-padding)+4px)]">
                                    {showDiscardConfirm ? (
                                        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                                            <p className="nb-ui-label flex items-center gap-1.5 text-foreground">
                                                <AlertTriangle className="size-4 text-[var(--status-warning)] shrink-0" />
                                                Discard unsaved changes?
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    onClick={() => setShowDiscardConfirm(false)}
                                                >
                                                    Keep editing
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    onClick={handleDiscard}
                                                >
                                                    Discard
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                                            {(saveErrorMessage || saveState === "saving" || hasChanges) ? <div className="min-w-0">
                                                {saveErrorMessage ? (
                                                    <p role="alert" className="nb-meta text-destructive">
                                                        {saveErrorMessage}
                                                    </p>
                                                ) : saveState === "saving" ? (
                                                    <p aria-live="polite" className="nb-meta text-muted-foreground flex items-center gap-1.5">
                                                        <Loader2 className="size-3.5 animate-spin text-primary" />
                                                        Saving changes…
                                                    </p>
                                                ) : hasChanges ? (
                                                    <p aria-live="polite" className="nb-meta text-muted-foreground flex items-center gap-1.5">
                                                        <span className="size-1.5 rounded-[2px] bg-[var(--status-warning)]" />
                                                        Unsaved changes
                                                    </p>
                                                ) : null}
                                            </div> : null}

                                            <div className="flex flex-wrap items-center justify-end gap-2">
                                                {conflictProfile ? <Button type="button" variant="outline" onClick={reviewLatestChanges} disabled={saveState === "saving"}>Review latest changes</Button> : null}
                                                {hasChanges ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        onClick={handleResetChanges}
                                                        disabled={saveState === "saving"}
                                                        title="Revert all fields to original values"
                                                    >
                                                        Reset
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleCancel}
                                                    disabled={saveState === "saving"}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    onClick={handleSave}
                                                    disabled={saveState === "saving" || !hasChanges || !user || user.id !== profile.id}
                                                >
                                                    {saveState === "saving" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                    Save changes
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </footer>
                            }
                        />
                    </fieldset>
                </form>
        </section>
    );
}
