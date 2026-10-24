"use client";

import { toast } from "@/lib/feedback";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
    Loader2,
    Camera,
    Plus,
    X,
    Trash2,
    CheckCircle2,
    AlertTriangle,
    Briefcase,
    Calendar,
    Link as LinkIcon,
    Code,
    Github,
    ChevronDown,
    Pencil,
    SlidersHorizontal,
    Globe,
    UserCheck,
    Wrench,
    ArrowUp,
    ArrowDown,
} from "lucide-react";
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from "@/app/actions/profile";
import { Input } from "@/components/ui/input";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { sanitizeUsernameInput } from "@/lib/validations/username";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { profileSharePath, shareOrigin } from "@/lib/sharing/presentation";
import { PROFILE_LIMITS } from "@/lib/validations/profile";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { compressAvatarOffMainThread } from "@/lib/services/avatar-worker-client";
import { publicAvatarVariantUrl } from "@/lib/profile/avatar-variants";
import {
    DESIGNATED_CATEGORIES,
    EXPERIENCE_LEVEL_OPTIONS,
    ROLE_PREFERENCE_OPTIONS,
    WEEKLY_CAPACITY_OPTIONS,
    getRolePreferences,
    replaceRolePreferences,
} from "@/lib/profile/role-preferences";
import { ContributionWorkspace } from "./ContributionWorkspace";
import {
    resolveSocialPresence,
    socialLinkItemsFromStorage,
    type SocialLinkItem,
    type SocialLinkStorage,
    validateSocialLinkCollection,
} from "@/lib/profile/normalization";
import { SocialPresenceIcon } from "@/components/profile/SocialPresenceIcon";
import { SortableLinkList } from "@/components/links/SortableLinkList";

const SkillPicker = dynamic(() => import("@/components/skills/SkillPicker").then((mod) => mod.SkillPicker), {
    ssr: false,
    loading: () => <div className="h-24 rounded-lg bg-muted" />,
});

export type { ProfileEditSection as EditProfileSection } from "@/lib/profile/edit-route";
import type { ProfileEditSection as EditProfileSection } from "@/lib/profile/edit-route";

interface EditProfileTabsProps {
    profile: any;
    contributionProfileId?: string;
    contributionProfileVisibility?: string;
    actions: ReactNode;
    originalUsername: string;
    section: EditProfileSection;
    onSectionChange: (section: EditProfileSection) => void;
    onChange: (updates: any) => void;
    contributionErrors?: Record<string, string>;
    contributionsSaving?: boolean;
    contributionsLoadingMore?: boolean;
    contributionHasMore?: boolean;
    contributionTotal?: number;
    onLoadMoreContributions?: () => void;
    onImageFinalized?: (avatarUrl: string, updatedAt?: string) => void;
    onCancelContribution?: () => void;
    showContributionExitPrompt?: boolean;
}

const EDIT_SECTIONS: Array<{
    id: EditProfileSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}> = [
    { id: "general", label: "General properties", icon: SlidersHorizontal },
    { id: "experience", label: "Project contributions", icon: Briefcase },
    { id: "skills", label: "Skills & expertise", icon: Wrench },
    { id: "social", label: "Social presence", icon: Globe },
    { id: "opportunity", label: "Role preferences", icon: UserCheck },
];

export function EditProfileTabs({
    profile,
    contributionProfileId = "",
    contributionProfileVisibility = "public",
    actions,
    originalUsername,
    section,
    onSectionChange,
    onChange,
    contributionErrors = {},
    contributionsSaving = false,
    contributionsLoadingMore = false,
    contributionHasMore = false,
    contributionTotal = 0,
    onLoadMoreContributions,
    onImageFinalized,
    onCancelContribution,
    showContributionExitPrompt = false,
}: EditProfileTabsProps) {
    const [avatarUploading, setAvatarUploading] = useState(false);
    const desktopNavigation = useMediaQuery("(min-width: 768px)");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const [contributionFooterHost, setContributionFooterHost] = useState<HTMLDivElement | null>(null);
    useEffect(() => { contentScrollRef.current?.scrollTo({top:0}); }, [section]);

    const { status: usernameStatus, message: usernameMessage } = useUsernameAvailability({
        value: profile.username,
        currentUsername: originalUsername,
        debounceMs: 500,
    });

    const updateForm = (key: string, value: any) => {
        onChange({ ...profile, [key]: value });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            toast.error("Image must be 2MB or smaller");
            return;
        }

        const previousAvatarUrl = profile.avatarUrl;
        const localPreview = URL.createObjectURL(file);
        updateForm("avatarUrl", localPreview);
        setAvatarUploading(true);

        try {
            const preparedAvatar = await compressAvatarOffMainThread(file);
            const uploadSession = await createProfileImageUploadUrlAction({
                mimeType: "image/jpeg",
                sizeBytes: preparedAvatar.size,
                kind: "avatar",
            });
            if (!uploadSession.success) {
                throw new Error(uploadSession.error || "Failed to prepare image upload");
            }

            await uploadToSupabaseSignedUrl(uploadSession, preparedAvatar, { cacheProfile: "public" });

            const finalized = await finalizeProfileImageUploadAction({
                uploadIntentId: uploadSession.uploadIntentId,
                commitToProfile: false,
            });
            if (!finalized.success) {
                throw new Error(finalized.error || "Failed to finalize image upload");
            }

            updateForm("avatarUrl", finalized.publicUrl);
            onImageFinalized?.(finalized.publicUrl, finalized.updatedAt);
            toast.message("Avatar ready to save");
        } catch (error: any) {
            updateForm("avatarUrl", previousAvatarUrl);
            const message = error?.message || "Unknown error";
            toast.error(`Failed to upload avatar: ${message}`);
        } finally {
            URL.revokeObjectURL(localPreview);
            setAvatarUploading(false);
            if (e.target) e.target.value = "";
        }
    };

    const handleRemoveAvatar = () => {
        updateForm("avatarUrl", "");
        toast.message("Avatar removed from your draft");
    };

    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        updateForm("username", sanitizeUsernameInput(e.target.value));
    };

    return (
        <Tabs
            value={section}
            onValueChange={(value) => onSectionChange(value as EditProfileSection)}
            className="w-full min-w-0 min-h-0 flex-1 flex flex-col gap-0 md:flex-row"
            orientation={desktopNavigation ? "vertical" : "horizontal"}
        >
            <aside aria-label="Profile edit sections" className="w-full min-h-0 shrink-0 border-b border-border bg-card px-3 py-4 md:w-[var(--nb-sidebar-width)] md:overflow-y-auto md:border-b-0 md:border-r">
                <div className="mb-3 space-y-3 px-2 pr-3">
                    {section === "experience" ? (
                        <p id="profile-editor-title" className="nb-micro">Edit profile</p>
                    ) : (
                        <h1 id="profile-editor-title" className="nb-micro">Edit profile</h1>
                    )}
                    <div className="h-px w-full bg-border" aria-hidden="true" />
                </div>
                <TabsList aria-label="Profile edit sections" className="flex flex-wrap h-auto min-h-0 w-full bg-transparent p-0 pr-1 border-none gap-1 items-stretch md:flex-col md:flex-nowrap">
                    {EDIT_SECTIONS.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <TabsTrigger
                                key={tab.id}
                                value={tab.id}
                                aria-current={section === tab.id ? "page" : undefined}
                                title={tab.label}
                                className={cn(
                                    "nb-nav-link group min-w-0 basis-[calc(50%-2px)] md:w-full md:basis-auto md:grow-0 justify-start text-left border-b-0 border-transparent focus-visible:outline-none focus-visible:brightness-95 data-[state=active]:shadow-none"
                                )}
                            >
                                <Icon className="size-4 shrink-0 transition-colors text-muted-foreground group-data-[state=active]:text-primary group-hover:text-foreground" />
                                <span className="block min-w-0 whitespace-normal break-words md:truncate md:whitespace-nowrap">{tab.label}</span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
            </aside>

            <div className="flex min-w-0 min-h-0 flex-1 flex-col bg-card">
            <div ref={contentScrollRef} data-scroll-root="route" className="min-w-0 min-h-0 flex-1 app-scroll app-scroll-y p-4 md:p-[calc(var(--ui-panel-padding)+4px)] bg-card">
                <div className="@container max-w-4xl mx-auto w-full">
                    <TabsContent value="general" className="space-y-8 mt-0">
                        <div className="flex flex-col gap-1">
                            <h2 className="nb-section-title text-foreground">General properties</h2>
                            <p className="nb-compact max-w-[64ch] text-muted-foreground">Manage your public identity, profile photo, and core professional details.</p>
                        </div>

                        {/* Profile photo */}
                        {(() => {
                            const avatarSrc = profile.avatarUrl;
                            return (
                                <div className="flex flex-col gap-4 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:justify-between pb-6 border-b border-border">
                                    <div className="flex min-w-0 flex-1 items-center gap-4">
                                        <div className="relative size-[72px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
                                            {avatarSrc ? (
                                                <Image
                                                    src={publicAvatarVariantUrl(avatarSrc, 128)}
                                                    alt="Profile avatar"
                                                    fill
                                                    className="object-cover"
                                                    sizes="72px"
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground">
                                                    {(profile.fullName?.[0] || profile.username?.[0] || "?").toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <h3 className="nb-card-title text-foreground">Profile photo</h3>
                                            <p className="nb-compact mt-0.5 text-muted-foreground">
                                                Square avatar displayed on your profile, project cards, and directory.
                                            </p>
                                            <div className="nb-meta mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                                                <span>JPG, PNG, or WebP</span>
                                                <span>•</span>
                                                <span>Up to 2MB</span>
                                                <span>•</span>
                                                <span>Recommended 400×400</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp"
                                            className="hidden"
                                            tabIndex={-1}
                                            aria-hidden="true"
                                            onChange={handleImageUpload}
                                            disabled={avatarUploading}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={avatarUploading}
                                            className="rounded-md"
                                        >
                                            {avatarUploading ? (
                                                <Loader2 className="mr-1.5 size-4 animate-spin" />
                                            ) : (
                                                <Camera className="mr-1.5 size-4" />
                                            )}
                                            {avatarSrc ? "Change photo" : "Upload photo"}
                                        </Button>
                                        {avatarSrc ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleRemoveAvatar}
                                                disabled={avatarUploading}
                                                className="text-muted-foreground hover:text-destructive rounded-md"
                                                title="Remove photo"
                                            >
                                                <Trash2 className="size-4" />
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Personal identity */}
                        <div className="border-b border-border space-y-4 pb-6">
                            <div>
                                <h3 className="nb-card-title text-foreground">Personal identity</h3>
                                <p className="nb-compact mt-0.5 text-muted-foreground">
                                    Your name, handle, and professional headline across NetworkBase.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 @min-[640px]:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-full-name" className="nb-ui-label text-foreground">
                                            Full name <span className="text-destructive">*</span>
                                        </label>
                                        <span id="profile-full-name-count" className="nb-meta text-muted-foreground font-normal">
                                            {(profile.fullName ?? "").length}/{PROFILE_LIMITS.fullNameMax}
                                        </span>
                                    </div>
                                    <Input
                                        id="profile-full-name"
                                        aria-describedby="profile-full-name-count"
                                        name="fullName"
                                        required
                                        minLength={1}
                                        maxLength={PROFILE_LIMITS.fullNameMax}
                                        value={profile.fullName ?? ""}
                                        onChange={(e) => updateForm("fullName", e.target.value)}
                                        placeholder="e.g. Satoshi Nakamoto"
                                        className="mt-2"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                        <label htmlFor="profile-username" className="nb-ui-label text-foreground">
                                            Username <span className="text-destructive">*</span>
                                        </label>
                                        <span id="profile-username-url" className="nb-meta min-w-0 break-all text-muted-foreground font-normal">
                                            {new URL(shareOrigin()).host}{profileSharePath(profile.username) || "/u/handle"}
                                        </span>
                                    </div>
                                    <div className="relative mt-2">
                                        <Input
                                            id="profile-username"
                                            name="username"
                                            aria-describedby={`profile-username-url profile-identity-help${usernameMessage ? " profile-username-hint" : ""}`}
                                            aria-invalid={usernameStatus === "invalid"}
                                            required
                                            minLength={PROFILE_LIMITS.usernameMin}
                                            maxLength={PROFILE_LIMITS.usernameMax}
                                            pattern="(?:[a-z0-9_]|-)+"
                                            value={profile.username ?? ""}
                                            onChange={handleUsernameChange}
                                            className={cn(
                                                "pr-9",
                                                usernameStatus === "invalid" && "border-destructive focus-visible:ring-destructive",
                                                usernameStatus === "valid" && "border-[var(--status-success)]",
                                            )}
                                            placeholder="username"
                                        />
                                        {usernameStatus === "checking" ? (
                                            <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            {usernameMessage ? (
                                <p id="profile-username-hint" className={cn(
                                    "nb-meta flex items-center gap-2 font-medium -mt-2",
                                    usernameStatus === "valid" && "text-[var(--status-success)]",
                                    usernameStatus === "checking" && "text-muted-foreground",
                                    usernameStatus === "invalid" && "text-destructive",
                                    usernameStatus === "error" && "text-[var(--status-warning)]",
                                )}>
                                    {usernameStatus === "valid" ? (
                                        <CheckCircle2 className="size-3.5" />
                                    ) : usernameStatus === "checking" ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                        <X className="size-3.5" />
                                    )}
                                    {usernameMessage}
                                </p>
                            ) : null}

                            <div className="flex items-start gap-3 rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-foreground">
                                <AlertTriangle className="size-4 shrink-0 text-[var(--status-warning)] mt-0.5" />
                                <div className="space-y-1">
                                    <p className="nb-ui-label text-foreground font-medium">Changing your identity</p>
                                    <p id="profile-identity-help" className="nb-compact max-w-[64ch] text-muted-foreground">
                                        Your public handle updates immediately. Note: You can only change your username once every 30 days. Cached mentions may take a little time to refresh.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="profile-headline" className="nb-ui-label text-foreground">
                                        Headline
                                    </label>
                                    <span id="profile-headline-count" className="nb-meta text-muted-foreground font-normal">
                                        {(profile.headline ?? "").length}/{PROFILE_LIMITS.headlineMax}
                                    </span>
                                </div>
                                <Input
                                    id="profile-headline"
                                    aria-describedby="profile-headline-count"
                                    name="headline"
                                    maxLength={PROFILE_LIMITS.headlineMax}
                                    value={profile.headline ?? ""}
                                    onChange={(e) => updateForm("headline", e.target.value)}
                                    placeholder="e.g. Senior Frontend Engineer · Open Source Contributor"
                                    className="mt-2"
                                />
                            </div>
                        </div>

                        {/* About & details */}
                        <div className="space-y-4">
                            <div>
                                <h3 className="nb-card-title text-foreground">About & details</h3>
                                <p className="nb-compact mt-0.5 text-muted-foreground">
                                    Extended background information, location, and your personal website.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="profile-bio" className="nb-ui-label text-foreground">
                                        Bio
                                    </label>
                                    <span id="profile-bio-count" className="nb-meta text-muted-foreground font-normal">
                                        {(profile.bio ?? "").length}/{PROFILE_LIMITS.bioMax}
                                    </span>
                                </div>
                                <textarea
                                    id="profile-bio"
                                    aria-describedby="profile-bio-count"
                                    name="bio"
                                    rows={4}
                                    maxLength={PROFILE_LIMITS.bioMax}
                                    value={profile.bio ?? ""}
                                    onChange={(e) => updateForm("bio", e.target.value)}
                                    className="nb-body min-h-24 w-full resize-y rounded-md border border-input bg-card px-[var(--ui-control-px)] py-2 text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    placeholder="Tell your story..."
                                />
                            </div>

                            <div className="grid grid-cols-1 @min-[640px]:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-location" className="nb-ui-label text-foreground">
                                            Location
                                        </label>
                                        <span id="profile-location-count" className="nb-meta text-muted-foreground font-normal">
                                            {(profile.location ?? "").length}/{PROFILE_LIMITS.locationMax}
                                        </span>
                                    </div>
                                    <Input
                                        id="profile-location"
                                        aria-describedby="profile-location-count"
                                        name="location"
                                        maxLength={PROFILE_LIMITS.locationMax}
                                        value={profile.location ?? ""}
                                        onChange={(e) => updateForm("location", e.target.value)}
                                        placeholder="e.g. San Francisco, CA or Remote"
                                        className="mt-2"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-website" className="nb-ui-label text-foreground">
                                            Website
                                        </label>
                                        <span id="profile-website-count" className="nb-meta text-muted-foreground font-normal">
                                            {(profile.website ?? "").length}/{PROFILE_LIMITS.websiteMax}
                                        </span>
                                    </div>
                                    <Input
                                        id="profile-website"
                                        aria-describedby="profile-website-count"
                                        name="website"
                                        type="url"
                                        pattern="https?://.*"
                                        maxLength={PROFILE_LIMITS.websiteMax}
                                        value={profile.website ?? ""}
                                        onChange={(e) => updateForm("website", e.target.value)}
                                        placeholder="https://example.com"
                                        className="mt-2"
                                    />
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="experience" forceMount hidden={section !== "experience"} className="mt-0">
                        <fieldset disabled={section !== "experience"} className="min-w-0">
                        <ContributionWorkspace profileId={contributionProfileId} profileVisibility={contributionProfileVisibility} items={profile.experience ?? []} hasMore={contributionHasMore} loadingMore={contributionsLoadingMore} onLoadMore={onLoadMoreContributions} footerContainer={contributionFooterHost} onCancel={onCancelContribution}/>
                        </fieldset>
                    </TabsContent>

                    <TabsContent value="skills" className="space-y-6 mt-0">
                        <h2 className="nb-section-title text-foreground">Skills & expertise</h2>
                        <SkillsEditor
                            skills={profile.skills ?? []}
                            onChange={(skills) => updateForm("skills", skills)}
                        />
                    </TabsContent>

                    <TabsContent value="social" className="space-y-6 mt-0">
                        <h2 className="nb-section-title text-foreground">Social presence</h2>
                        <SocialLinksEditor
                            links={profile.socialLinks ?? {}}
                            metadata={profile.socialLinkMetadata ?? {}}
                            onChange={(links) => updateForm("socialLinks", links)}
                        />
                    </TabsContent>

                    <TabsContent value="opportunity" className="space-y-6 mt-0">
                        <h2 id="role-preferences-heading" className="nb-section-title text-foreground">Role preferences</h2>
                        <RolePreferencesEditor profile={profile} onChange={onChange} />
                    </TabsContent>
                </div>
            </div>
            <div ref={setContributionFooterHost} hidden={section !== "experience" || showContributionExitPrompt} data-contribution-footer-host className="shrink-0" />
            {section !== "experience" || showContributionExitPrompt ? actions : null}
            </div>
        </Tabs>
    );
}

function RolePreferencesEditor({ profile, onChange }: { profile: any; onChange: (updates: any) => void }) {
    const selectedRoles = new Set(getRolePreferences(profile.openTo))
    const hasPreferences = selectedRoles.size > 0 || Boolean(profile.experienceLevel) || Boolean(profile.hoursPerWeek) || (profile.openToCustomRoles && profile.openToCustomRoles.length > 0) || (profile.preferredCategories && profile.preferredCategories.length > 0)
    const [customRoleInput, setCustomRoleInput] = useState("");
    const [customCategoryInput, setCustomCategoryInput] = useState("");

    const toggleRole = (role: string) => {
        const next = new Set(selectedRoles)
        if (next.has(role as any)) next.delete(role as any)
        else next.add(role as any)
        onChange({
            ...profile,
            openTo: replaceRolePreferences(profile.openTo, [...next]),
        })
    }

    const customRoles: string[] = profile.openToCustomRoles || [];
    const categories: string[] = profile.preferredCategories || [];

    const handleAddCustomRole = (roleCandidate?: string) => {
        const raw = typeof roleCandidate === "string" ? roleCandidate : customRoleInput;
        const trimmed = raw.trim().slice(0, PROFILE_LIMITS.listItemMax);
        if (!trimmed) return;

        const alreadyExists = customRoles.some((r: string) => r.toLowerCase() === trimmed.toLowerCase());
        if (alreadyExists) {
            toast.info(`"${trimmed}" is already in your desired roles.`);
            setCustomRoleInput("");
            return;
        }

        if (customRoles.length >= PROFILE_LIMITS.listMaxItems) {
            toast.error(`You can add up to ${PROFILE_LIMITS.listMaxItems} desired roles.`);
            return;
        }

        onChange({
            ...profile,
            openToCustomRoles: [...customRoles, trimmed],
        });
        setCustomRoleInput("");
    };

    const handleRemoveCustomRole = (role: string) => {
        onChange({
            ...profile,
            openToCustomRoles: customRoles.filter((r: string) => r.toLowerCase() !== role.toLowerCase()),
        });
    };

    const toggleCategory = (category: string) => {
        const existing = categories.find((c: string) => c.toLowerCase() === category.toLowerCase());
        if (existing) {
            onChange({
                ...profile,
                preferredCategories: categories.filter((c: string) => c.toLowerCase() !== category.toLowerCase()),
            });
        } else {
            if (categories.length >= PROFILE_LIMITS.listMaxItems) {
                toast.error(`You can add up to ${PROFILE_LIMITS.listMaxItems} categories.`);
                return;
            }
            onChange({
                ...profile,
                preferredCategories: [...categories, category],
            });
        }
    };

    const handleAddCustomCategory = () => {
        const trimmed = customCategoryInput.trim().slice(0, PROFILE_LIMITS.listItemMax);
        if (!trimmed) return;

        const matchingDesignated = DESIGNATED_CATEGORIES.find(
            (c) => c.toLowerCase() === trimmed.toLowerCase()
        );
        const canonicalName = matchingDesignated || trimmed;

        const alreadyExists = categories.some((c: string) => c.toLowerCase() === canonicalName.toLowerCase());
        if (alreadyExists) {
            toast.info(`"${canonicalName}" is already in your categories.`);
            setCustomCategoryInput("");
            return;
        }

        if (categories.length >= PROFILE_LIMITS.listMaxItems) {
            toast.error(`You can add up to ${PROFILE_LIMITS.listMaxItems} categories.`);
            return;
        }

        onChange({
            ...profile,
            preferredCategories: [...categories, canonicalName],
        });
        setCustomCategoryInput("");
    };

    const handleRemoveCategory = (categoryToRemove: string) => {
        onChange({
            ...profile,
            preferredCategories: categories.filter((c: string) => c.toLowerCase() !== categoryToRemove.toLowerCase()),
        });
    };

    const customCategories = categories.filter(
        (c: string) => !DESIGNATED_CATEGORIES.some((d) => d.toLowerCase() === c.toLowerCase())
    );

    const POPULAR_ROLE_SUGGESTIONS = [
        "Frontend Developer",
        "Full Stack Engineer",
        "Product Designer",
        "AI / ML Engineer",
        "Backend Developer",
        "DevOps Engineer",
    ] as const;

    const availableRoleSuggestions = POPULAR_ROLE_SUGGESTIONS.filter(
        (suggestion) => !customRoles.some((r: string) => r.toLowerCase() === suggestion.toLowerCase())
    );

    return (
        <section aria-labelledby="role-preferences-heading" className="space-y-6">
            <div>
                <p className="nb-compact max-w-[64ch] text-muted-foreground">
                    Choose the role types, roles, categories, and weekly hours that suit you.
                </p>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between gap-4">
                    <label className="flex items-center gap-2 nb-ui-label cursor-pointer" htmlFor="open-to-collaborate-switch">
                        <span>Open to collaborate</span>
                        {profile.openToCollaborate ? (
                            <span className="nb-micro inline-flex items-center gap-1 rounded-[4px] border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-[2px] bg-emerald-500" aria-hidden="true" />
                                Available
                            </span>
                        ) : (
                            <span className="nb-micro inline-flex items-center gap-1 rounded-[4px] border border-border bg-muted/60 px-2 py-0.5 text-muted-foreground">
                                Hidden
                            </span>
                        )}
                    </label>
                    <SettingsSwitch
                        id="open-to-collaborate-switch"
                        aria-label="Open to collaborate"
                        aria-describedby="collaboration-availability-help"
                        checked={profile.openToCollaborate === true}
                        onCheckedChange={(checked) => onChange({ ...profile, openToCollaborate: checked })}
                    />
                </div>
                <p id="collaboration-availability-help" className="nb-compact max-w-[64ch] text-muted-foreground">
                    Save changes to publish your availability. Turning it off keeps your role preferences.
                </p>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="nb-ui-label text-foreground">Role types</p>
                    {selectedRoles.size > 0 && (
                        <span className="nb-micro text-muted-foreground">{selectedRoles.size} selected</span>
                    )}
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Role types">
                    {ROLE_PREFERENCE_OPTIONS.map((option) => {
                        const selected = selectedRoles.has(option.value)
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleRole(option.value)}
                                className={cn(
                                    "nb-ui-label nb-touch-target min-h-[var(--ui-control-height-sm)] rounded-[3px] border px-3 py-1 transition-colors focus-visible:brightness-95",
                                    selected
                                        ? "border-foreground bg-foreground text-background font-medium"
                                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                            >
                                {option.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="nb-ui-label text-foreground">Categories</p>
                    {categories.length > 0 && (
                        <span className="nb-micro text-muted-foreground">{categories.length}/{PROFILE_LIMITS.listMaxItems} selected</span>
                    )}
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Designated categories">
                    {DESIGNATED_CATEGORIES.map((category) => {
                        const selected = categories.some((c: string) => c.toLowerCase() === category.toLowerCase());
                        return (
                            <button
                                key={category}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleCategory(category)}
                                className={cn(
                                    "nb-ui-label nb-touch-target min-h-[var(--ui-control-height-sm)] rounded-[3px] border px-3 py-1 transition-colors focus-visible:brightness-95",
                                    selected
                                        ? "border-foreground bg-foreground text-background font-medium"
                                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                            >
                                {category}
                            </button>
                        );
                    })}
                </div>

                <div className="pt-1">
                    <div className="flex gap-2">
                        <Input
                            id="profile-custom-category"
                            value={customCategoryInput}
                            onChange={(e) => setCustomCategoryInput(e.target.value)}
                            aria-label="Custom category"
                            placeholder="e.g. Developer Relations, BioTech, Robotics, FinOps"
                            maxLength={PROFILE_LIMITS.listItemMax}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAddCustomCategory();
                                }
                            }}
                            className="flex-1"
                        />
                        <Button type="button" onClick={handleAddCustomCategory}>Add category</Button>
                    </div>
                    {customCategories.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2" aria-label="Custom categories">
                            {customCategories.map((cat: string) => (
                                <span
                                    key={cat}
                                    className="nb-tag inline-flex min-w-0 max-w-full items-center gap-2 rounded-[3px] border border-border bg-muted px-2 py-1 font-medium text-foreground"
                                >
                                    <span className="min-w-0 break-words">{cat}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveCategory(cat)}
                                        aria-label={`Remove category ${cat}`}
                                        className="nb-icon-button nb-touch-target shrink-0 text-muted-foreground hover:text-foreground"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label htmlFor="profile-desired-role" className="nb-ui-label text-foreground">Desired roles</label>
                    {customRoles.length > 0 && (
                        <span className="nb-micro text-muted-foreground">{customRoles.length}/{PROFILE_LIMITS.listMaxItems} roles</span>
                    )}
                </div>
                <div className="flex gap-2">
                    <Input
                        id="profile-desired-role"
                        value={customRoleInput}
                        onChange={(e) => setCustomRoleInput(e.target.value)}
                        aria-label="Desired role title"
                        placeholder="e.g. Next.js Developer, Rust Dev"
                        maxLength={PROFILE_LIMITS.listItemMax}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCustomRole();
                            }
                        }}
                        className="flex-1"
                    />
                    <Button type="button" onClick={() => handleAddCustomRole()}>Add role</Button>
                </div>
                {availableRoleSuggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="nb-micro text-muted-foreground">Quick suggestions:</span>
                        {availableRoleSuggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => handleAddCustomRole(suggestion)}
                                className="nb-micro rounded border border-dashed border-border bg-card/60 px-2 py-0.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-muted hover:text-foreground"
                            >
                                + {suggestion}
                            </button>
                        ))}
                    </div>
                )}
                {customRoles.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1" aria-label="Desired roles">
                        {customRoles.map((role: string) => (
                            <span
                                key={role}
                                className="nb-tag inline-flex min-w-0 max-w-full items-center gap-2 rounded-[3px] border border-border bg-muted px-2 py-1 font-medium text-foreground"
                            >
                                <span className="min-w-0 break-words">{role}</span>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveCustomRole(role)}
                                    aria-label={`Remove desired role ${role}`}
                                    className="nb-icon-button nb-touch-target shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid gap-4 @min-[640px]:grid-cols-2">
                <label className="nb-ui-label block space-y-2 text-foreground">
                    <span id="profile-experience-label">Experience level</span>
                    <select
                        aria-labelledby="profile-experience-label"
                        value={profile.experienceLevel ?? ''}
                        onChange={(event) => onChange({ ...profile, experienceLevel: event.target.value || null })}
                        className="nb-body h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card px-[var(--ui-control-px)] text-foreground outline-none focus-visible:bg-muted/20"
                    >
                        <option value="">Not specified</option>
                        {EXPERIENCE_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className="nb-ui-label block space-y-2 text-foreground">
                    <span id="profile-hours-label">Weekly hours</span>
                    <select
                        aria-labelledby="profile-hours-label"
                        value={profile.hoursPerWeek ?? ''}
                        onChange={(event) => onChange({ ...profile, hoursPerWeek: event.target.value || null })}
                        className="nb-body h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card px-[var(--ui-control-px)] text-foreground outline-none focus-visible:bg-muted/20"
                    >
                        <option value="">Not specified</option>
                        {WEEKLY_CAPACITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
            </div>

            {hasPreferences ? (
                <button
                    type="button"
                    onClick={() => onChange({
                        ...profile,
                        openTo: replaceRolePreferences(profile.openTo, []),
                        openToCustomRoles: [],
                        preferredCategories: [],
                        experienceLevel: null,
                        hoursPerWeek: null,
                    })}
                    className="nb-ui-label nb-touch-target text-muted-foreground hover:text-destructive focus-visible:brightness-95"
                >
                    Clear role preferences
                </button>
            ) : null}
        </section>
    )
}

function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (skills: string[]) => void }) {
    return <SkillPicker value={skills} onChange={onChange} maxSkills={25} />;
}

type SocialLinkEditorEntry = {
    id: string;
    item: SocialLinkItem;
    presence: ReturnType<typeof resolveSocialPresence>;
    name: string;
};

function SortableSocialLinkCard({
    entry,
    unavailable,
    onEdit,
    onRemove,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
}: {
    entry: SocialLinkEditorEntry;
    unavailable: boolean;
    onEdit: (key: string, item: SocialLinkItem) => void;
    onRemove: (key: string) => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
}) {
    const { id, item, presence, name } = entry;

    return (
        <>
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {presence?.iconKey ? <SocialPresenceIcon iconKey={presence.iconKey} className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="nb-ui-label truncate text-foreground">{name}</p>
                {unavailable ? <p className="nb-micro mt-1 text-[var(--status-warning)]">Needs update — this link was unavailable when opened.</p> : null}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
                {canMoveUp && onMoveUp ? (
                    <Button type="button" variant="ghost" size="icon" onClick={onMoveUp} aria-label={`Move ${name} up`} className="nb-touch-target size-8 text-muted-foreground hover:text-foreground">
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                ) : null}
                {canMoveDown && onMoveDown ? (
                    <Button type="button" variant="ghost" size="icon" onClick={onMoveDown} aria-label={`Move ${name} down`} className="nb-touch-target size-8 text-muted-foreground hover:text-foreground">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                ) : null}
                <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(id, item)} aria-label={`Edit ${name}`} className="nb-touch-target size-8">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(id)} aria-label={`Remove ${name}`} className="nb-touch-target size-8 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
            </div>
        </>
    );
}

function SocialLinksEditor({ links, metadata, onChange }: { links: SocialLinkStorage; metadata: Record<string, { health?: string; checkedAt?: string }>; onChange: (links: SocialLinkItem[]) => void }) {
    const [newUrl, setNewUrl] = useState("");
    const [customLabel, setCustomLabel] = useState("");
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [linkError, setLinkError] = useState<string | null>(null);
    const trimmedNewUrl = newUrl.trim();
    const items = useMemo(() => socialLinkItemsFromStorage(links), [links]);
    const entries = useMemo(() => items
        .map((item) => {
            const presence = resolveSocialPresence(item.platform, item.url);
            const isGenericWebsite = ['website', 'portfolio', 'other'].includes(presence?.platform || '');
            return {
                id: item.id,
                item,
                presence,
                name: isGenericWebsite ? (item.label || presence?.accountLabel || 'Website') : (presence?.platformLabel || item.platform || 'Link'),
            };
        }), [items]);
    const candidate = useMemo(
        () => trimmedNewUrl ? validateSocialLinkCollection([{ id: 'draft-link', platform: 'website', url: trimmedNewUrl }]) : null,
        [trimmedNewUrl],
    );
    const previewItem = candidate?.success ? candidate.links[0] : null;
    const preview = previewItem ? resolveSocialPresence(previewItem.platform, previewItem.url) : null;
    const previewIsGenericWebsite = ['website', 'portfolio', 'other'].includes(preview?.platform || '');
    const previewName = previewIsGenericWebsite ? (customLabel.trim() || preview?.accountLabel) : preview?.platformLabel;

    const resetDraft = () => {
        setNewUrl("");
        setCustomLabel("");
        setEditingKey(null);
        setLinkError(null);
    };

    const handleSave = () => {
        if (!candidate?.success || !preview) {
            setLinkError(candidate?.success === false ? candidate.error : 'Enter a valid public web address.');
            return;
        }
        const next = items.filter((item) => item.id !== editingKey);
        const draftId = editingKey || `link-${Date.now().toString(36)}`;
        const resolved = candidate.links[0]!;
        // Custom labels are meaningful only for unrecognised/public sites. Known
        // services retain their official service name for consistent display.
        next.push({
            ...resolved,
            id: draftId,
            order: next.length,
            ...(previewIsGenericWebsite && customLabel.trim() ? { label: customLabel.trim() } : {}),
        });
        onChange(next.map((item, index) => ({ ...item, order: index })));
        resetDraft();
    };

    const remove = (key: string) => {
        onChange(items.filter((item) => item.id !== key).map((item, index) => ({ ...item, order: index })));
        if (editingKey === key) resetDraft();
    };

    const moveItem = (index: number, direction: 'up' | 'down') => {
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= items.length) return;
        const reordered = [...items];
        const temp = reordered[index]!;
        reordered[index] = reordered[targetIndex]!;
        reordered[targetIndex] = temp;
        onChange(reordered.map((item, idx) => ({ ...item, order: idx })));
    };

    const edit = (key: string, item: SocialLinkItem) => {
        setEditingKey(key);
        setNewUrl(item.url);
        setCustomLabel(item.label || "");
        setLinkError(null);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h3 className="nb-card-title text-foreground">Your public links</h3>
                    <p className="nb-compact mt-1 text-muted-foreground">Show people where they can verify your work and follow you.</p>
                </div>
                <span className="nb-meta rounded-[3px] bg-muted px-2.5 py-1 font-medium text-muted-foreground">{entries.length} {entries.length === 1 ? "link" : "links"}</span>
            </div>

            {entries.length ? (
                <SortableLinkList
                    items={entries}
                    layout="grid"
                    className="grid gap-2 @min-[640px]:grid-cols-2"
                    itemClassName="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
                    handleClassName="-mr-1"
                    getItemLabel={(entry) => entry.name}
                    onReorder={(next) => onChange(next.map((entry, order) => ({ ...entry.item, order })))}
                >
                    {(entry, index) => (
                        <SortableSocialLinkCard
                            entry={entry}
                            unavailable={metadata[entry.id]?.health === 'unavailable'}
                            onEdit={edit}
                            onRemove={remove}
                            onMoveUp={() => moveItem(index, 'up')}
                            onMoveDown={() => moveItem(index, 'down')}
                            canMoveUp={index > 0}
                            canMoveDown={index < entries.length - 1}
                        />
                    )}
                </SortableLinkList>
            ) : (
                <div className="nb-empty-state nb-grid-ground rounded-md border border-dashed border-border px-4 py-5 text-center">
                    <p className="nb-compact text-muted-foreground">Add a public profile, portfolio, or website to get started.</p>
                </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="nb-card-title text-foreground">{editingKey ? "Edit link" : "Add a link"}</h3>
                        <p className="nb-compact mt-1 text-muted-foreground">Paste any public address. Familiar services are named automatically; other sites use their domain name.</p>
                    </div>
                    {editingKey ? <Button type="button" variant="ghost" size="sm" onClick={resetDraft}>Cancel edit</Button> : null}
                </div>

                <div className="mt-4">
                    <label htmlFor="profile-social-url" className="nb-ui-label text-foreground">Public link</label>
                    <Input
                        id="profile-social-url"
                        name="socialUrl"
                        type="url"
                        pattern="https?://.*"
                        maxLength={PROFILE_LIMITS.websiteMax}
                        placeholder="Paste a profile, portfolio, or website link"
                        value={newUrl}
                        onChange={(e) => { setNewUrl(e.target.value); setLinkError(null); }}
                        className="mt-1.5 bg-background"
                    />
                </div>

                {previewIsGenericWebsite ? (
                    <div className="mt-3">
                        <label htmlFor="profile-social-label" className="nb-ui-label text-foreground">Display name <span className="font-normal text-muted-foreground">(optional)</span></label>
                        <Input id="profile-social-label" value={customLabel} maxLength={80} onChange={(e) => setCustomLabel(e.target.value)} placeholder={preview?.accountLabel || "My portfolio"} className="mt-1.5 bg-background" />
                    </div>
                ) : null}

                {preview ? (
                    <div aria-live="polite" className="nb-compact mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            {preview.iconKey ? <SocialPresenceIcon iconKey={preview.iconKey} className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground"><strong>{previewName}</strong>{!previewIsGenericWebsite ? <span className="text-muted-foreground"> · {preview.accountLabel}</span> : null}</span>
                        <span className="nb-meta shrink-0 text-muted-foreground">Detected from URL</span>
                    </div>
                ) : trimmedNewUrl ? (
                    <p role="status" className="nb-compact mt-3 text-[var(--status-warning)]">{candidate?.success === false ? candidate.error : 'Enter a valid public http(s) URL.'}</p>
                ) : null}
                {linkError ? <p role="alert" className="nb-compact mt-3 text-destructive">{linkError}</p> : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="nb-compact max-w-md text-muted-foreground">Only public http(s) links can be saved. Links are checked again when someone opens them.</p>
                    <Button type="button" onClick={handleSave} disabled={!preview}>{editingKey ? "Save link" : "Add link"}</Button>
                </div>
            </div>
        </div>
    );
}
