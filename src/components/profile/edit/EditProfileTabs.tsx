"use client";

import { toast } from "@/lib/feedback";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
    Plus,
    X,
    Trash2,
    Calendar,
    Link as LinkIcon,
    Code,
    Github,
    ChevronDown,
    Pencil,
    ArrowUp,
    ArrowDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ProfileTabBar } from "@/components/profile/v2/ProfileTabBar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import ChipSelector, { choiceChipClass } from "@/components/onboarding/ChipSelector";
import { INTEREST_OPTIONS } from "@/lib/profile/interests";
import type { UsernameAvailabilityStatus } from "@/hooks/useUsernameAvailability";
import { DetailsSection, EditPanel } from "./DetailsSection";
import { cn } from "@/lib/utils";
import { PROFILE_LIMITS } from "@/lib/validations/profile";
import { PROFILE_FIELD_LIMITS } from "@/lib/validations/profile-fields";
import {
    DESIGNATED_CATEGORIES,
    EXPERIENCE_LEVEL_OPTIONS,
    ROLE_PREFERENCE_OPTIONS,
    WEEKLY_CAPACITY_OPTIONS,
    getRolePreferences,
    replaceRolePreferences,
} from "@/lib/profile/role-preferences";
import { ContributionEditor } from "./ContributionEditor";
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
    /** The preview band, the Changes card and the phone save bar come from the editor (it owns the draft). */
    preview: ReactNode;
    card: ReactNode;
    phoneBar?: ReactNode;
    /** Sections with unsaved changes get the orange square on their tab. */
    dirtySections?: ReadonlySet<EditProfileSection>;
    /** Once the tab bar floats past the name, it carries Save. */
    tabAction?: ReactNode;
    originalUsername: string;
    baseAvatarUrl: string;
    usernameCheck: { status: UsernameAvailabilityStatus; message: string };
    usernameNextChangeAt?: string | null;
    showWebsiteError?: boolean;
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

const EDIT_SECTIONS: Array<{ id: EditProfileSection; label: string }> = [
    { id: "general", label: "Details" },
    { id: "experience", label: "Contributions" },
    { id: "skills", label: "Skills" },
    { id: "social", label: "Links" },
    { id: "opportunity", label: "Collaboration" },
];

export function EditProfileTabs({
    profile,
    contributionProfileId = "",
    contributionProfileVisibility = "public",
    preview,
    card,
    phoneBar,
    dirtySections,
    tabAction,
    originalUsername,
    baseAvatarUrl,
    usernameCheck,
    usernameNextChangeAt,
    showWebsiteError,
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
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const [contributionFooterHost, setContributionFooterHost] = useState<HTMLDivElement | null>(null);
    // Switching sections keeps the tab bar where it is: past the band it stays floating, above it nothing moves.
    useEffect(() => {
        const root = contentScrollRef.current, bar = root?.querySelector<HTMLElement>("[data-pf-tabbar]");
        if (root && bar && root.scrollTop > bar.offsetTop - 8) root.scrollTo({ top: bar.offsetTop - 8 });
    }, [section]);

    const updateForm = (key: string, value: any) => {
        onChange({ ...profile, [key]: value });
    };

    return (
        <Tabs value={section} onValueChange={(value) => onSectionChange(value as EditProfileSection)} className="contents">
            <div ref={contentScrollRef} data-scroll-root="route" className="min-h-0 min-w-0 flex-1 overflow-y-auto app-scroll app-scroll-y bg-background">
            <div className="nb-pf-page nb-pf-edit">
                <h1 id="profile-editor-title" className="sr-only">Edit profile</h1>
                {preview}
                <ProfileTabBar
                    label="Profile edit sections"
                    idPrefix="profile-edit"
                    value={section}
                    onChange={onSectionChange}
                    tabs={EDIT_SECTIONS.map((tab) => ({
                        key: tab.id,
                        label: tab.label,
                        count: tab.id === "experience" ? contributionTotal : tab.id === "skills" ? (profile.skills ?? []).length : tab.id === "social" ? socialLinkItemsFromStorage(profile.socialLinks ?? {}).length : undefined,
                        dirty: dirtySections?.has(tab.id),
                    }))}
                    identity={{ name: profile.fullName || profile.username || "Your name", avatar: <UserAvatar identity={profile} className="size-[26px]" roundedClassName="rounded-[5px]" sizes="26px" /> }}
                    action={tabAction}
                />
                <div className="nb-pf-body">
                <div className="nb-pf-col min-w-0">
                <div className="@container w-full">
                    <TabsContent value="general" className="mt-0">
                        <DetailsSection profile={profile} baseAvatarUrl={baseAvatarUrl} originalUsername={originalUsername} username={usernameCheck}
                            usernameNextChangeAt={usernameNextChangeAt} showWebsiteError={showWebsiteError} onField={updateForm} onImageFinalized={onImageFinalized} />
                    </TabsContent>

                    <TabsContent value="experience" forceMount hidden={section !== "experience"} className="mt-0">
                        <fieldset disabled={section !== "experience"} className="min-w-0">
                        <ContributionEditor profileId={contributionProfileId} profileVisibility={contributionProfileVisibility} items={profile.experience ?? []} hasMore={contributionHasMore} loadingMore={contributionsLoadingMore} onLoadMore={onLoadMoreContributions} footerContainer={contributionFooterHost} onCancel={onCancelContribution}/>
                        </fieldset>
                    </TabsContent>

                    <TabsContent value="skills" className="nb-pf-edit-sec mt-0">
                        <SkillsEditor
                            skills={profile.skills ?? []}
                            onChange={(skills) => updateForm("skills", skills)}
                        />
                        <InterestsEditor
                            interests={profile.interests ?? []}
                            onChange={(interests) => updateForm("interests", interests)}
                        />
                    </TabsContent>

                    <TabsContent value="social" className="nb-pf-edit-sec mt-0">
                        <SocialLinksEditor
                            links={profile.socialLinks ?? {}}
                            metadata={profile.socialLinkMetadata ?? {}}
                            onChange={(links) => updateForm("socialLinks", links)}
                        />
                    </TabsContent>

                    <TabsContent value="opportunity" className="nb-pf-edit-sec mt-0">
                        <RolePreferencesEditor profile={profile} onChange={onChange} />
                    </TabsContent>
                </div>
                <div ref={setContributionFooterHost} hidden={section !== "experience" || showContributionExitPrompt} data-contribution-footer-host className="shrink-0" />
                </div>
                <aside className="nb-pf-rail" aria-label="Your changes">{card}</aside>
                </div>
            </div>
            {phoneBar}
            </div>
        </Tabs>
    );
}

function InterestsEditor({ interests, onChange }: { interests: string[]; onChange: (interests: string[]) => void }) {
    // An interest saved earlier that is not in the suggested list stays visible and removable.
    const known = new Set(INTEREST_OPTIONS.map((option) => option.value));
    const options = [...INTEREST_OPTIONS, ...interests.filter((value) => !known.has(value)).map((value) => ({ value, label: value }))];
    const toggle = (value: string) => {
        if (interests.includes(value)) return onChange(interests.filter((item) => item !== value));
        if (interests.length >= PROFILE_FIELD_LIMITS.tagMaxItems) {
            toast.warning(`You can add up to ${PROFILE_FIELD_LIMITS.tagMaxItems} interests.`);
            return;
        }
        onChange([...interests, value]);
    };
    return (
        <EditPanel title="Interests">
            <p className="nb-pf-help mb-2.5">Topics you care about. They help people with the same interests find you.</p>
            <ChipSelector options={options} selected={new Set(interests)} onToggle={toggle} labelledBy="pf-edit-interests" maxVisible={options.length} />
        </EditPanel>
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
            toast.info(`"${trimmed}" is already in your desired roles`);
            setCustomRoleInput("");
            return;
        }

        if (customRoles.length >= PROFILE_LIMITS.listMaxItems) {
            toast.warning(`You can add up to ${PROFILE_LIMITS.listMaxItems} desired roles.`);
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
                toast.warning(`You can add up to ${PROFILE_LIMITS.listMaxItems} categories.`);
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
            toast.info(`"${canonicalName}" is already in your categories`);
            setCustomCategoryInput("");
            return;
        }

        if (categories.length >= PROFILE_LIMITS.listMaxItems) {
            toast.warning(`You can add up to ${PROFILE_LIMITS.listMaxItems} categories.`);
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
        "Frontend developer",
        "Full stack engineer",
        "Product designer",
        "AI / ML Engineer",
        "Backend developer",
        "DevOps Engineer",
    ] as const;

    const availableRoleSuggestions = POPULAR_ROLE_SUGGESTIONS.filter(
        (suggestion) => !customRoles.some((r: string) => r.toLowerCase() === suggestion.toLowerCase())
    );

    const [allCategories, setAllCategories] = useState(false);
    const open = profile.openToCollaborate === true;
    const dim = open ? undefined : "is-dim";
    const picked = (category: string) => categories.some((c: string) => c.toLowerCase() === category.toLowerCase());
    // First nine, plus anything you picked further down, so a choice never hides behind "Show all".
    const shownCategories = DESIGNATED_CATEGORIES.filter((category, index) => allCategories || index < 9 || picked(category));
    const clearAll = () => {
        const before = { openTo: profile.openTo, openToCustomRoles: customRoles, preferredCategories: categories, experienceLevel: profile.experienceLevel ?? null, hoursPerWeek: profile.hoursPerWeek ?? null };
        onChange({ ...profile, openTo: replaceRolePreferences(profile.openTo, []), openToCustomRoles: [], preferredCategories: [], experienceLevel: null, hoursPerWeek: null });
        toast("Preferences cleared", { action: { label: "Undo", onClick: () => latest.current({ ...latestProfile.current, ...before }) } });
    };
    const latest = useRef(onChange);
    latest.current = onChange;
    const latestProfile = useRef(profile);
    latestProfile.current = profile;
    const selectClass = "nb-body h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card px-[var(--ui-control-px)] text-foreground outline-none focus-visible:bg-muted/20";

    return (
        <>
            <EditPanel title="Availability">
                <div className="nb-pf-eopen">
                    <label className="flex items-center gap-2.5 nb-ui-label cursor-pointer" htmlFor="open-to-collaborate-switch">
                        <SettingsSwitch
                            id="open-to-collaborate-switch"
                            aria-label="Open to collaboration"
                            aria-describedby="collaboration-availability-help"
                            checked={open}
                            onCheckedChange={(checked) => onChange({ ...profile, openToCollaborate: checked })}
                        />
                        <b className="font-semibold">Open to collaboration</b>
                    </label>
                    <span id="collaboration-availability-help" className="nb-pf-tagpv">
                        {open ? <><span className="nb-pf-tag">Open to collaborate</span><span>shows on your header</span></> : <span>Hidden from your header. Your preferences are kept.</span>}
                    </span>
                </div>
                <div className="nb-pf-egrid mt-3.5">
                    <label className="nb-ui-label grid gap-1.5 text-foreground">
                        <span id="profile-experience-label">Experience level</span>
                        <select aria-labelledby="profile-experience-label" value={profile.experienceLevel ?? ''} onChange={(event) => onChange({ ...profile, experienceLevel: event.target.value || null })} className={selectClass}>
                            <option value="">Not specified</option>
                            {EXPERIENCE_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label className="nb-ui-label grid gap-1.5 text-foreground">
                        <span id="profile-hours-label">Weekly availability</span>
                        <select aria-labelledby="profile-hours-label" value={profile.hoursPerWeek ?? ''} onChange={(event) => onChange({ ...profile, hoursPerWeek: event.target.value || null })} className={selectClass}>
                            <option value="">Not specified</option>
                            {WEEKLY_CAPACITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                </div>
            </EditPanel>

            {open ? null : <p className="nb-pf-dimnote"><span className="nb-pf-pv">Hidden</span>You’re not open to collaboration, so these don’t show. They’re kept for when you turn it back on.</p>}

            <div className={dim}>
                <EditPanel title="Role types" extra={<span className="nb-pf-pct">{selectedRoles.size} picked</span>}>
                    <span id="role-types-label" className="sr-only">Role types</span>
                    <ChipSelector options={[...ROLE_PREFERENCE_OPTIONS]} selected={selectedRoles as Set<string>} onToggle={toggleRole} labelledBy="role-types-label" maxVisible={ROLE_PREFERENCE_OPTIONS.length} showCount={false} />
                </EditPanel>
            </div>

            <div className={dim}>
                <EditPanel title="Categories" extra={<span className="nb-pf-pct">{categories.length} / {PROFILE_LIMITS.listMaxItems}</span>}>
                    <span id="categories-label" className="sr-only">Categories</span>
                    <ChipSelector
                        options={shownCategories.map((category) => ({ value: category, label: category }))}
                        selected={new Set<string>(DESIGNATED_CATEGORIES.filter(picked))}
                        onToggle={toggleCategory}
                        labelledBy="categories-label"
                        maxVisible={DESIGNATED_CATEGORIES.length}
                        showCount={false}
                    />
                    <button type="button" className="nb-pf-link mt-2" onClick={() => setAllCategories((v) => !v)}>{allCategories ? "Show fewer" : `Show all ${DESIGNATED_CATEGORIES.length}`}</button>
                    {customCategories.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2.5" aria-label="Your own categories">
                            {customCategories.map((cat: string) => (
                                <span key={cat} className="nb-tag inline-flex min-w-0 max-w-full items-center gap-2 rounded-[3px] border border-border bg-muted px-2 py-1 font-medium text-foreground">
                                    <span className="min-w-0 break-words">{cat}</span>
                                    <button type="button" onClick={() => handleRemoveCategory(cat)} aria-label={`Remove category ${cat}`} className="nb-icon-button nb-touch-target shrink-0 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="mt-3 flex gap-2">
                        <Input id="profile-custom-category" value={customCategoryInput} onChange={(e) => setCustomCategoryInput(e.target.value)} aria-label="Add a category"
                            placeholder="Something else? e.g. Robotics, FinOps" maxLength={PROFILE_LIMITS.listItemMax}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCustomCategory(); } }} className="flex-1" />
                        <Button type="button" variant="outline" onClick={handleAddCustomCategory}>Add</Button>
                    </div>
                </EditPanel>
            </div>

            <div className={dim}>
                <EditPanel title="Preferred roles" extra={<span className="nb-pf-pct">{customRoles.length} / {PROFILE_LIMITS.listMaxItems}</span>}>
                    <div className="flex gap-2">
                        <Input id="profile-desired-role" value={customRoleInput} onChange={(e) => setCustomRoleInput(e.target.value)} aria-label="Add a preferred role"
                            placeholder="e.g. Next.js developer, Rust developer" maxLength={PROFILE_LIMITS.listItemMax}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCustomRole(); } }} className="flex-1" />
                        <Button type="button" variant="outline" onClick={() => handleAddCustomRole()}>Add role</Button>
                    </div>
                    {customRoles.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2.5" aria-label="Your preferred roles">
                            {customRoles.map((role: string) => (
                                <span key={role} className="nb-tag inline-flex min-w-0 max-w-full items-center gap-2 rounded-[3px] border border-border bg-muted px-2 py-1 font-medium text-foreground">
                                    <span className="min-w-0 break-words">{role}</span>
                                    <button type="button" onClick={() => handleRemoveCustomRole(role)} aria-label={`Remove desired role ${role}`} className="nb-icon-button nb-touch-target shrink-0 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                                </span>
                            ))}
                        </div>
                    )}
                    {availableRoleSuggestions.length > 0 && (
                        <>
                            <p className="nb-pf-sublabel">Suggestions</p>
                            <div className="flex flex-wrap gap-1.5">
                                {availableRoleSuggestions.map((suggestion) => (
                                    <button key={suggestion} type="button" onClick={() => handleAddCustomRole(suggestion)} className={cn(choiceChipClass(false), "border-dashed")}>
                                        <Plus className="mr-1 size-3" aria-hidden="true" />{suggestion}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {hasPreferences ? <button type="button" onClick={clearAll} className="nb-pf-clear">Clear all preferences</button> : null}
                </EditPanel>
            </div>
        </>
    )
}

function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (skills: string[]) => void }) {
    return (
        <EditPanel title="Skills">
            <div id="profile-skills">
                <SkillPicker value={skills} onChange={onChange} maxSkills={25} reorderable
                    label="Your skills, in the order they show on your profile" description="Drag to reorder, or focus one and press ← →" />
            </div>
        </EditPanel>
    );
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
    const handle = presence?.accountLabel && presence.accountLabel !== name ? presence.accountLabel : null;

    return (
        <>
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {presence?.iconKey ? <SocialPresenceIcon iconKey={presence.iconKey} className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="nb-ui-label truncate text-foreground">{name}</p>
                {handle ? <p className="nb-meta truncate text-muted-foreground">{handle}</p> : null}
                {unavailable ? <p className="mt-0.5 text-[12px] leading-snug text-[var(--status-warning)]">Needs update · this link didn’t open last time</p> : null}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
                {unavailable ? <Button type="button" variant="outline" size="sm" onClick={() => onEdit(id, item)}>Fix</Button> : null}
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
    const sameUrl = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
    const duplicate = Boolean(previewItem && items.some((item) => item.id !== editingKey && sameUrl(item.url) === sameUrl(previewItem.url)));
    // Undo after a remove puts the link back into the list as it is then, not as it was.
    const latest = useRef({ items, onChange });
    latest.current = { items, onChange };

    const resetDraft = () => {
        setNewUrl("");
        setCustomLabel("");
        setEditingKey(null);
        setLinkError(null);
    };

    const handleSave = () => {
        if (duplicate) return;
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
        const index = items.findIndex((item) => item.id === key);
        const removed = items[index];
        onChange(items.filter((item) => item.id !== key).map((item, order) => ({ ...item, order })));
        if (editingKey === key) resetDraft();
        if (!removed) return;
        const name = entries[index]?.name ?? "Link";
        toast(`${name} removed`, { action: { label: "Undo", onClick: () => {
            const current = latest.current.items.filter((item) => item.id !== removed.id);
            current.splice(Math.min(index, current.length), 0, removed);
            latest.current.onChange(current.map((item, order) => ({ ...item, order })));
        } } });
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
        <>
        <EditPanel title="Your public links" extra={<span className="nb-pf-pct">{entries.length}</span>}>
            {entries.length ? <p className="nb-pf-help mb-2">Drag to reorder. The first ones show first.</p> : null}
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
                <div className="nb-pf-empty">
                    <b>No links yet</b>
                    <span>Add GitHub, LinkedIn or your site so people can see your work.</span>
                </div>
            )}
        </EditPanel>

        <EditPanel title={editingKey ? "Edit link" : "Add a link"}>
                <div>
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
                        <span className="nb-meta shrink-0 text-muted-foreground">Found from the link</span>
                    </div>
                ) : trimmedNewUrl ? (
                    <p role="status" className="nb-compact mt-3 text-[var(--status-warning)]">{candidate?.success === false ? candidate.error : 'Enter a valid public http(s) URL.'}</p>
                ) : null}
                {duplicate ? <p role="status" className="nb-compact mt-3 text-destructive">You already have this link.</p> : null}
                {linkError ? <p role="alert" className="nb-compact mt-3 text-destructive">{linkError}</p> : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="nb-compact max-w-md text-muted-foreground">Only public links. They’re checked again when someone opens them.</p>
                    <span className="flex gap-2">
                        {editingKey ? <Button type="button" variant="ghost" onClick={resetDraft}>Cancel</Button> : null}
                        <Button type="button" onClick={handleSave} disabled={!preview || duplicate}>{editingKey ? "Save link" : "Add link"}</Button>
                    </span>
                </div>
        </EditPanel>
        </>
    );
}
