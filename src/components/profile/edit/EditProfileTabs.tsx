"use client";

import { toast } from "sonner";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { sanitizeUsernameInput } from "@/lib/validations/username";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { PROFILE_LIMITS } from "@/lib/validations/profile";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { compressAvatarOffMainThread } from "@/lib/services/avatar-worker-client";
import { publicAvatarVariantUrl } from "@/lib/profile/avatar-variants";
import {
    EXPERIENCE_LEVEL_OPTIONS,
    ROLE_PREFERENCE_OPTIONS,
    WEEKLY_CAPACITY_OPTIONS,
    getRolePreferences,
    replaceRolePreferences,
} from "@/lib/profile/role-preferences";
import {
    contributionEntryChanged,
    createExternalContributionDraft,
    type ContributionEditorEntry,
} from "@/lib/profile/contribution-editor";
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

export type EditProfileSection = "general" | "experience" | "education" | "skills" | "social" | "opportunity";

interface EditProfileTabsProps {
    profile: any;
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
}

const EDIT_SECTIONS: Array<{
    id: EditProfileSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}> = [
    { id: "general", label: "General Properties", icon: SlidersHorizontal },
    { id: "experience", label: "Project Contributions", icon: Briefcase },
    { id: "skills", label: "Skills & Expertise", icon: Wrench },
    { id: "social", label: "Social Presence", icon: Globe },
    { id: "opportunity", label: "Role Preferences", icon: UserCheck },
];

export function EditProfileTabs({
    profile,
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
}: EditProfileTabsProps) {
    const [avatarUploading, setAvatarUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
            toast.success("Avatar ready to save");
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
        toast.success("Avatar removed");
    };

    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        updateForm("username", sanitizeUsernameInput(e.target.value));
    };

    return (
        <Tabs
            value={section}
            onValueChange={(value) => onSectionChange(value as EditProfileSection)}
            className="w-full h-full flex flex-col md:flex-row"
            orientation="vertical"
        >
            <aside aria-label="Profile edit sections" className="w-full md:w-[200px] shrink-0 border-r border-border bg-card p-3 flex flex-col gap-1 overflow-y-auto">
                <div className="px-2.5 py-1.5 font-mono text-[10px] max-md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Profile Sections
                </div>
                <TabsList className="flex flex-col h-auto w-full bg-transparent p-0 border-none gap-1 items-stretch">
                    {EDIT_SECTIONS.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <TabsTrigger
                                key={tab.id}
                                value={tab.id}
                                className={cn(
                                    "group flex min-h-[38px] w-full items-center justify-start gap-2.5 rounded-md px-3 py-2 text-left border-b-0 border-transparent transition-colors duration-[130ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                )}
                            >
                                <Icon className="size-4 shrink-0 transition-colors text-muted-foreground group-data-[state=active]:text-primary group-hover:text-foreground" />
                                <span className="nb-ui-label block truncate">{tab.label}</span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
            </aside>

            <div className="flex-1 app-scroll app-scroll-y p-6 md:p-8 bg-card">
                <div className="max-w-3xl mx-auto w-full">
                    <TabsContent value="general" className="space-y-6 mt-0">
                        <div className="flex flex-col gap-1 pb-1">
                            <h2 className="nb-section-title text-foreground">General Properties</h2>
                            <p className="nb-compact text-muted-foreground">Manage your public identity, profile photo, and core professional details.</p>
                        </div>

                        {/* Profile photo */}
                        {(() => {
                            const avatarSrc = profile.avatarUrl;
                            return (
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-4 border-b border-border">
                                    <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
                                        <div className="relative size-20 sm:size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
                                            {avatarSrc ? (
                                                <Image
                                                    src={publicAvatarVariantUrl(avatarSrc, 128)}
                                                    alt="Profile avatar"
                                                    fill
                                                    className="object-cover"
                                                    sizes="96px"
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
                        <div className="py-2 border-b border-border space-y-5 pb-6">
                            <div>
                                <h3 className="nb-card-title text-foreground">Personal identity</h3>
                                <p className="nb-compact mt-0.5 text-muted-foreground">
                                    Your name, handle, and professional headline across NetworkBase.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-full-name" className="nb-ui-label text-foreground">
                                            Full Name <span className="text-destructive">*</span>
                                        </label>
                                        <span className="nb-meta text-muted-foreground font-normal">
                                            {(profile.fullName ?? "").length}/{PROFILE_LIMITS.fullNameMax}
                                        </span>
                                    </div>
                                    <Input
                                        id="profile-full-name"
                                        name="fullName"
                                        required
                                        minLength={1}
                                        maxLength={PROFILE_LIMITS.fullNameMax}
                                        value={profile.fullName ?? ""}
                                        onChange={(e) => updateForm("fullName", e.target.value)}
                                        placeholder="e.g. Satoshi Nakamoto"
                                        className="mt-1"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-username" className="nb-ui-label text-foreground">
                                            Username <span className="text-destructive">*</span>
                                        </label>
                                        <span className="nb-meta text-muted-foreground font-normal">
                                            networkbase.org/u/{profile.username || "handle"}
                                        </span>
                                    </div>
                                    <div className="relative mt-1">
                                        <Input
                                            id="profile-username"
                                            name="username"
                                            required
                                            minLength={PROFILE_LIMITS.usernameMin}
                                            maxLength={PROFILE_LIMITS.usernameMax}
                                            pattern="(?:[a-z0-9_]|-)+"
                                            value={profile.username ?? ""}
                                            onChange={handleUsernameChange}
                                            className={cn(
                                                "pr-9",
                                                usernameStatus === "invalid" && "border-destructive focus-visible:ring-destructive",
                                                usernameStatus === "valid" && "border-green-600 dark:border-green-500",
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
                                <p className={cn(
                                    "nb-meta flex items-center gap-1.5 font-medium -mt-2",
                                    usernameStatus === "valid" && "text-green-600 dark:text-green-500",
                                    usernameStatus === "checking" && "text-muted-foreground",
                                    usernameStatus === "invalid" && "text-destructive",
                                    usernameStatus === "error" && "text-amber-600 dark:text-amber-400",
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

                            <div className="flex items-start gap-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-foreground">
                                <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
                                <div className="space-y-0.5">
                                    <p className="nb-ui-label text-foreground font-medium">Changing your identity</p>
                                    <p className="nb-compact text-muted-foreground">
                                        Your public handle updates immediately. Note: You can only change your username once every 30 days. Cached mentions may take a little time to refresh.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="profile-headline" className="nb-ui-label text-foreground">
                                        Headline
                                    </label>
                                    <span className="nb-meta text-muted-foreground font-normal">
                                        {(profile.headline ?? "").length}/{PROFILE_LIMITS.headlineMax}
                                    </span>
                                </div>
                                <Input
                                    id="profile-headline"
                                    name="headline"
                                    maxLength={PROFILE_LIMITS.headlineMax}
                                    value={profile.headline ?? ""}
                                    onChange={(e) => updateForm("headline", e.target.value)}
                                    placeholder="e.g. Senior Frontend Engineer · Open Source Contributor"
                                    className="mt-1"
                                />
                            </div>
                        </div>

                        {/* About & Details */}
                        <div className="py-2 space-y-5">
                            <div>
                                <h3 className="nb-card-title text-foreground">About & Details</h3>
                                <p className="nb-compact mt-0.5 text-muted-foreground">
                                    Extended background information, location, and your personal website.
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="profile-bio" className="nb-ui-label text-foreground">
                                        Bio
                                    </label>
                                    <span className="nb-meta text-muted-foreground font-normal">
                                        {(profile.bio ?? "").length}/{PROFILE_LIMITS.bioMax}
                                    </span>
                                </div>
                                <textarea
                                    id="profile-bio"
                                    name="bio"
                                    rows={4}
                                    maxLength={PROFILE_LIMITS.bioMax}
                                    value={profile.bio ?? ""}
                                    onChange={(e) => updateForm("bio", e.target.value)}
                                    className="nb-body min-h-[100px] w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    placeholder="Tell your story..."
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-location" className="nb-ui-label text-foreground">
                                            Location
                                        </label>
                                        <span className="nb-meta text-muted-foreground font-normal">
                                            {(profile.location ?? "").length}/{PROFILE_LIMITS.locationMax}
                                        </span>
                                    </div>
                                    <Input
                                        id="profile-location"
                                        name="location"
                                        maxLength={PROFILE_LIMITS.locationMax}
                                        value={profile.location ?? ""}
                                        onChange={(e) => updateForm("location", e.target.value)}
                                        placeholder="e.g. San Francisco, CA or Remote"
                                        className="mt-1"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="profile-website" className="nb-ui-label text-foreground">
                                            Website
                                        </label>
                                        <span className="nb-meta text-muted-foreground font-normal">
                                            {(profile.website ?? "").length}/{PROFILE_LIMITS.websiteMax}
                                        </span>
                                    </div>
                                    <Input
                                        id="profile-website"
                                        name="website"
                                        type="url"
                                        pattern="https?://.*"
                                        maxLength={PROFILE_LIMITS.websiteMax}
                                        value={profile.website ?? ""}
                                        onChange={(e) => updateForm("website", e.target.value)}
                                        placeholder="https://example.com"
                                        className="mt-1"
                                    />
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="experience" className="space-y-6 mt-0">
                        <h2 className="nb-section-title text-foreground">Project Contributions</h2>
                        <ProjectContributionsList
                            items={profile.experience ?? []}
                            originalItems={profile.contributionBase ?? []}
                            onChange={(items) => updateForm("experience", items)}
                            errors={contributionErrors}
                            saving={contributionsSaving}
                            loadingMore={contributionsLoadingMore}
                            hasMore={contributionHasMore}
                            total={contributionTotal}
                            onLoadMore={onLoadMoreContributions}
                        />
                    </TabsContent>

                    <TabsContent value="skills" className="space-y-6 mt-0">
                        <h2 className="nb-section-title text-foreground">Skills & Expertise</h2>
                        <SkillsEditor
                            skills={profile.skills ?? []}
                            onChange={(skills) => updateForm("skills", skills)}
                        />
                    </TabsContent>

                    <TabsContent value="social" className="space-y-6 mt-0">
                        <h2 className="nb-section-title text-foreground">Social Presence</h2>
                        <SocialLinksEditor
                            links={profile.socialLinks ?? {}}
                            metadata={profile.socialLinkMetadata ?? {}}
                            onChange={(links) => updateForm("socialLinks", links)}
                        />
                    </TabsContent>

                    <TabsContent value="opportunity" className="space-y-6 mt-0">
                        <h2 className="nb-section-title text-foreground">Role Preferences</h2>
                        <RolePreferencesEditor profile={profile} onChange={onChange} />
                    </TabsContent>
                </div>
            </div>
        </Tabs>
    );
}

function RolePreferencesEditor({ profile, onChange }: { profile: any; onChange: (updates: any) => void }) {
    const selectedRoles = new Set(getRolePreferences(profile.openTo))
    const hasPreferences = selectedRoles.size > 0 || Boolean(profile.experienceLevel) || Boolean(profile.hoursPerWeek) || (profile.openToCustomRoles && profile.openToCustomRoles.length > 0) || (profile.preferredCategories && profile.preferredCategories.length > 0)
    const [customRoleInput, setCustomRoleInput] = useState("");

    const toggleRole = (role: string) => {
        const next = new Set(selectedRoles)
        if (next.has(role as any)) next.delete(role as any)
        else next.add(role as any)
        onChange({
            ...profile,
            openTo: replaceRolePreferences(profile.openTo, [...next]),
        })
    }

    const customRoles = profile.openToCustomRoles || [];
    const categories = profile.preferredCategories || [];

    const handleAddCustomRole = () => {
        const trimmed = customRoleInput.trim();
        if (trimmed && !customRoles.includes(trimmed)) {
            onChange({
                ...profile,
                openToCustomRoles: [...customRoles, trimmed],
            });
        }
        setCustomRoleInput("");
    };

    const handleRemoveCustomRole = (role: string) => {
        onChange({
            ...profile,
            openToCustomRoles: customRoles.filter((r: string) => r !== role),
        });
    };

    const toggleCategory = (category: string) => {
        const next = new Set(categories);
        if (next.has(category)) {
            next.delete(category);
        } else {
            next.add(category);
        }
        onChange({
            ...profile,
            preferredCategories: [...next],
        });
    };

    const ROLE_CATEGORIES = ["Engineering", "Design", "Product", "Growth"] as const;

    return (
        <section aria-labelledby="role-preferences-heading" className="space-y-6">
            <div>
                <p className="nb-compact text-muted-foreground">
                    Define the custom roles, commitment levels, and categories visitors should see on your builder profile.
                </p>
            </div>

            <div className="space-y-3">
                <label className="nb-ui-label text-foreground">Standard Availability Type</label>
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
                                    "nb-ui-label rounded-full border px-3 py-1.5 transition-colors",
                                    selected
                                        ? "border-primary/30 bg-primary/10 text-primary font-medium"
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
                <label className="nb-ui-label text-foreground">Role Categories</label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Role categories">
                    {ROLE_CATEGORIES.map((category) => {
                        const selected = categories.includes(category);
                        return (
                            <button
                                key={category}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleCategory(category)}
                                className={cn(
                                    "nb-ui-label rounded-full border px-3 py-1.5 transition-colors",
                                    selected
                                        ? "border-primary/30 bg-primary/10 text-primary font-medium"
                                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                            >
                                {category}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-3">
                <label className="nb-ui-label text-foreground">Custom Role Desired Titles</label>
                <div className="flex gap-2">
                    <Input
                        value={customRoleInput}
                        onChange={(e) => setCustomRoleInput(e.target.value)}
                        placeholder="e.g. Next.js Developer, Rust Dev"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCustomRole();
                            }
                        }}
                        className="flex-1"
                    />
                    <Button type="button" onClick={handleAddCustomRole}>Add</Button>
                </div>
                {customRoles.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {customRoles.map((role: string) => (
                            <span
                                key={role}
                                className="nb-tag inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 font-medium text-foreground"
                            >
                                {role}
                                <button
                                    type="button"
                                    onClick={() => handleRemoveCustomRole(role)}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="nb-ui-label space-y-2 text-muted-foreground">
                    <span>Experience level</span>
                    <select
                        value={profile.experienceLevel ?? ''}
                        onChange={(event) => onChange({ ...profile, experienceLevel: event.target.value || null })}
                        className="nb-body h-10 w-full rounded-md border border-border bg-background px-3 text-foreground outline-none"
                    >
                        <option value="">Not specified</option>
                        {EXPERIENCE_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className="nb-ui-label space-y-2 text-muted-foreground">
                    <span>Weekly capacity</span>
                    <select
                        value={profile.hoursPerWeek ?? ''}
                        onChange={(event) => onChange({ ...profile, hoursPerWeek: event.target.value || null })}
                        className="nb-body h-10 w-full rounded-md border border-border bg-background px-3 text-foreground outline-none"
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
                    className="nb-ui-label text-muted-foreground hover:text-destructive"
                >
                    Clear role preferences
                </button>
            ) : null}
        </section>
    )
}

function ProjectContributionsList({
    items = [],
    originalItems = [],
    onChange,
    errors = {},
    saving = false,
    loadingMore = false,
    hasMore = false,
    total = 0,
    onLoadMore,
}: {
    items: ContributionEditorEntry[];
    originalItems: ContributionEditorEntry[];
    onChange: (items: ContributionEditorEntry[]) => void;
    errors?: Record<string, string>;
    saving?: boolean;
    loadingMore?: boolean;
    hasMore?: boolean;
    total?: number;
    onLoadMore?: () => void;
}) {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [focusRequest, setFocusRequest] = useState(0);
    const focusDraftRef = useRef<string | null>(null);
    const projectInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const accordionId = useId().replace(/:/g, "");
    const originalById = new Map(originalItems.map((item) => [item.draftId, item]));
    const incompleteExternalDraft = items.find((item) =>
        item.kind === "external" && !item.contributionId && !item.projectTitle.trim(),
    );
    const unsavedDrafts = items.filter((item) => item.kind === "external" && !item.contributionId);
    const persistedItems = items.filter((item) => item.contributionId);
    const displayItems = [...unsavedDrafts, ...persistedItems];

    useEffect(() => {
        const firstError = Object.keys(errors)[0];
        if (firstError) setExpandedKey(firstError);
    }, [errors]);

    useEffect(() => {
        const draftId = focusDraftRef.current;
        if (!draftId || expandedKey !== draftId) return;
        const input = projectInputRefs.current[draftId];
        if (!input) return;
        input.scrollIntoView({ block: "nearest", behavior: "smooth" });
        input.focus();
        focusDraftRef.current = null;
    }, [displayItems, expandedKey, focusRequest]);

    const updateItem = (draftId: string, updates: Partial<ContributionEditorEntry>) => {
        onChange(items.map((item) => item.draftId === draftId ? { ...item, ...updates } : item));
    };

    const handleAddExternal = () => {
        if (incompleteExternalDraft) {
            setExpandedKey(incompleteExternalDraft.draftId);
            focusDraftRef.current = incompleteExternalDraft.draftId;
            setFocusRequest((current) => current + 1);
            setAnnouncement("Finish or remove the current external-project draft before adding another.");
            return;
        }
        const draft = createExternalContributionDraft();
        focusDraftRef.current = draft.draftId;
        onChange([draft, ...items]);
        setExpandedKey(draft.draftId);
        setFocusRequest((current) => current + 1);
        setAnnouncement("External project added. Enter its project name to continue.");
    };

    const handleDeleteExternal = (draftId: string) => {
        onChange(items.filter((item) => item.draftId !== draftId));
        setExpandedKey((current) => current === draftId ? null : current);
    };

    return (
        <div className="space-y-6">
            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="nb-card-title text-foreground">Your contributions</h3>
                    <p className="nb-compact mt-1 text-muted-foreground">
                        Open one project at a time. Platform project names and roles come from the project team.
                        {total > 0 ? ` Showing ${Math.min(persistedItems.length, total)} of ${total} saved.` : ""}
                        {unsavedDrafts.length > 0 ? ` ${unsavedDrafts.length} unsaved external ${unsavedDrafts.length === 1 ? "project" : "projects"}.` : ""}
                    </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleAddExternal} disabled={saving}>
                    <Plus className="mr-1 h-4 w-4" /> Add external project
                </Button>
            </div>

            {items.length === 0 ? (
                <div className="nb-empty-state nb-grid-ground rounded-lg px-5 py-8 text-center">
                    <p className="nb-card-title text-foreground">No project contributions yet</p>
                    <p className="nb-compact mt-1 text-muted-foreground">Platform contributions appear after you join a project. You can also add an external project.</p>
                </div>
            ) : null}

            <div className="space-y-3">
                {unsavedDrafts.length > 0 ? (
                    <p className="nb-micro text-amber-700 dark:text-amber-400">
                        Unsaved external projects
                    </p>
                ) : null}
                {displayItems.map((item) => {
                    const isPublic = item.visibility === "public";
                    const isExpanded = expandedKey === item.draftId;
                    const panelId = `${accordionId}-contribution-${item.draftId}`;
                    const isDirty = contributionEntryChanged(item, originalById.get(item.draftId));
                    const itemError = errors[item.draftId];
                    return (
                        <div key={item.draftId} data-contribution-draft-id={item.draftId} className="overflow-hidden rounded-lg border border-border bg-card">
                            <button
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={panelId}
                                onClick={() => setExpandedKey((current) => current === item.draftId ? null : item.draftId)}
                                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-semibold text-foreground">{item.projectTitle || "Untitled external project"}</span>
                                    <span className="nb-meta mt-1 block truncate text-muted-foreground">{item.roleTitle || "Role not specified"}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                    {itemError ? <span className="nb-micro text-destructive">Needs attention</span> : null}
                                    {!itemError && saving && isDirty ? <span className="nb-micro text-primary">Saving…</span> : null}
                                    {!itemError && !saving && isDirty ? <span className="nb-micro text-amber-600 dark:text-amber-400">Unsaved</span> : null}
                                    {item.kind === "external" ? <span className="nb-micro text-muted-foreground">External</span> : null}
                                    {!isPublic ? <span className="nb-micro text-muted-foreground">Private</span> : null}
                                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                                </span>
                            </button>

                            {isExpanded ? (
                                <div id={panelId} className="space-y-5 border-t border-border p-5">
                                    {itemError ? (
                                        <p role="alert" aria-live="assertive" className="nb-compact rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-destructive">
                                            {itemError}
                                        </p>
                                    ) : null}
                                    {item.kind === "external" ? (
                                        <div className="flex justify-end">
                                            <Button type="button" variant="ghost" size="sm" onClick={() => handleDeleteExternal(item.draftId)} className="nb-touch-target h-8 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                                <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                                            </Button>
                                        </div>
                                    ) : null}

                                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-4">
                                        <div className="space-y-0.5">
                                            <span className="nb-ui-label font-semibold text-foreground">Show publicly on profile</span>
                                            <p className="nb-compact text-muted-foreground">Off keeps this contribution visible only to you.</p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={isPublic}
                                            aria-label={`${isPublic ? "Hide" : "Show"} ${item.projectTitle || "project contribution"} on profile`}
                                            onClick={() => updateItem(item.draftId, { visibility: isPublic ? "private" : "public" })}
                                            className={`${isPublic ? "bg-primary" : "bg-muted"} relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                                        >
                                            <span aria-hidden="true" className={`${isPublic ? "translate-x-5" : "translate-x-0"} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition`} />
                                        </button>
                                    </div>

                                    {item.kind === "platform" ? (
                                        <dl className="grid grid-cols-1 gap-4 rounded-lg bg-muted/40 p-4 md:grid-cols-2">
                                            <div><dt className="nb-meta text-muted-foreground">Project</dt><dd className="nb-compact mt-1 font-medium text-foreground">{item.projectTitle}</dd></div>
                                            <div><dt className="nb-meta text-muted-foreground">Your role</dt><dd className="nb-compact mt-1 font-medium text-foreground">{item.roleTitle}</dd></div>
                                        </dl>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <div>
                                                <label htmlFor={`${panelId}-project`} className="nb-ui-label flex items-center gap-1.5 text-muted-foreground"><Briefcase className="h-3.5 w-3.5" /> Project name</label>
                                                <Input ref={(node) => { projectInputRefs.current[item.draftId] = node; }} id={`${panelId}-project`} maxLength={120} aria-required="true" value={item.projectTitle} onChange={(event) => updateItem(item.draftId, { projectTitle: event.target.value })} className="mt-1.5 h-10" />
                                            </div>
                                            <div>
                                                <label htmlFor={`${panelId}-role`} className="nb-ui-label flex items-center gap-1.5 text-muted-foreground"><Code className="h-3.5 w-3.5" /> Your role</label>
                                                <Input id={`${panelId}-role`} maxLength={120} value={item.roleTitle} onChange={(event) => updateItem(item.draftId, { roleTitle: event.target.value })} className="mt-1.5 h-10" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <div>
                                            <label htmlFor={`${panelId}-start`} className="nb-ui-label flex items-center gap-1.5 text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> Joined</label>
                                            <Input id={`${panelId}-start`} type="month" value={item.startedAt} onChange={(event) => updateItem(item.draftId, { startedAt: event.target.value })} className="mt-1.5 h-10" />
                                        </div>
                                        <div>
                                            <label htmlFor={`${panelId}-end`} className="nb-ui-label flex items-center gap-1.5 text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> Ended (optional)</label>
                                            <Input id={`${panelId}-end`} type="month" value={item.endedAt} onChange={(event) => updateItem(item.draftId, { endedAt: event.target.value })} className="mt-1.5 h-10" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        {item.kind === "external" ? (
                                            <div>
                                                <label htmlFor={`${panelId}-url`} className="nb-ui-label flex items-center gap-1.5 text-muted-foreground"><LinkIcon className="h-3.5 w-3.5" /> Project URL</label>
                                                <Input id={`${panelId}-url`} type="url" value={item.projectUrl} onChange={(event) => updateItem(item.draftId, { projectUrl: event.target.value })} className="mt-1.5 h-10" placeholder="https://" />
                                            </div>
                                        ) : <div />}
                                        <div>
                                            <label htmlFor={`${panelId}-repo`} className="nb-ui-label flex items-center gap-1.5 text-muted-foreground"><Github className="h-3.5 w-3.5" /> Repository URL</label>
                                            <Input id={`${panelId}-repo`} type="url" value={item.repositoryUrl} onChange={(event) => updateItem(item.draftId, { repositoryUrl: event.target.value })} className="mt-1.5 h-10" placeholder="https://github.com/..." />
                                        </div>
                                    </div>

                                    <SkillPicker value={item.skills} onChange={(skills) => updateItem(item.draftId, { skills })} maxSkills={20} label="Skills & tools" description="Choose the skills demonstrated in this contribution." placeholder="Search skills" />

                                    <div>
                                        <label htmlFor={`${panelId}-summary`} className="nb-ui-label text-muted-foreground">Contribution summary</label>
                                        <textarea id={`${panelId}-summary`} maxLength={2000} className="nb-body mt-1.5 min-h-[96px] w-full resize-none rounded-md border border-border bg-background px-4 py-3 outline-none focus:bg-card text-foreground" value={item.summary} onChange={(event) => updateItem(item.draftId, { summary: event.target.value })} placeholder="What did you build, improve, or lead?" />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {hasMore && onLoadMore ? (
                <div className="flex justify-center border-t border-border pt-4">
                    <Button type="button" variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore || saving}>
                        {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {loadingMore ? "Loading contributions…" : "Load more contributions"}
                    </Button>
                </div>
            ) : null}
        </div>
    );
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
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {presence?.iconKey ? <SocialPresenceIcon iconKey={presence.iconKey} className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="nb-ui-label truncate text-foreground">{name}</p>
                {unavailable ? <p className="nb-micro mt-1 text-amber-600 dark:text-amber-400">Needs update — this link was unavailable when opened.</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {canMoveUp && onMoveUp ? (
                    <Button type="button" variant="ghost" size="icon" onClick={onMoveUp} aria-label={`Move ${name} up`} className="size-8 text-muted-foreground hover:text-foreground">
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                ) : null}
                {canMoveDown && onMoveDown ? (
                    <Button type="button" variant="ghost" size="icon" onClick={onMoveDown} aria-label={`Move ${name} down`} className="size-8 text-muted-foreground hover:text-foreground">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                ) : null}
                <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(id, item)} aria-label={`Edit ${name}`} className="size-8">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(id)} aria-label={`Remove ${name}`} className="size-8 text-muted-foreground hover:text-destructive">
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
        <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <p className="nb-card-title text-foreground">Your public links</p>
                    <p className="nb-compact mt-1 text-muted-foreground">Show people where they can verify your work and follow you.</p>
                </div>
                <span className="nb-meta rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">{entries.length} {entries.length === 1 ? "link" : "links"}</span>
            </div>

            {entries.length ? (
                <SortableLinkList
                    items={entries}
                    layout="grid"
                    className="grid gap-2 sm:grid-cols-2"
                    itemClassName="flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card p-3"
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
                <div className="nb-body rounded-md border border-dashed border-border bg-muted/40 px-4 py-5 text-muted-foreground">
                    Add a public profile, portfolio, or website to get started.
                </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="nb-card-title text-foreground">{editingKey ? "Edit link" : "Add a link"}</p>
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
                    <div aria-live="polite" className="nb-compact mt-3 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            {preview.iconKey ? <SocialPresenceIcon iconKey={preview.iconKey} className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground"><strong>{previewName}</strong>{!previewIsGenericWebsite ? <span className="text-muted-foreground"> · {preview.accountLabel}</span> : null}</span>
                        <span className="nb-meta shrink-0 text-muted-foreground">Detected from URL</span>
                    </div>
                ) : trimmedNewUrl ? (
                    <p role="status" className="nb-compact mt-3 text-amber-600 dark:text-amber-400">{candidate?.success === false ? candidate.error : 'Enter a valid public http(s) URL.'}</p>
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
