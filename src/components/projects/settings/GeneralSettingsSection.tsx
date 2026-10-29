'use client';

import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { broadcastProjectUpdated } from "@/components/projects/ProjectAvatar";
import {
    Camera,
    ChevronDown,
    Loader2,
    Trash2,
    Upload,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { clearProjectCoverImageAction, updateProject } from "@/app/actions/project";
import {
    ALLOWED_PROJECT_IMAGE_MIME_TYPES,
    PROJECT_IMAGE_OUTPUT_SIZE,
    PROJECT_IMAGE_PREVIEW_SIZE,
    PROJECT_IMAGE_UPLOAD_MAX_BYTES,
    uploadProjectImage,
} from "@/lib/upload/project-image-upload-client";
import {
    isKnownProjectType,
    OTHER_PROJECT_TYPE_ID,
    POPULAR_PROJECT_TAGS,
} from "@/lib/projects/project-create-options";
import {
    type ProjectMemberRole,
    type ProjectSettingsMember,
} from "@/lib/projects/settings-policies";
import { CategorySelector, ChipEditor, ReadOnlySlugField, SettingsCard, TextAreaField, TextField } from '@/components/projects/settings/SettingsFormFields';

// ponytail: dynamic code-splitting for SkillPicker catalog (378 KB) so settings tab initial chunk stays small. ceiling: settings tab. upgrade: keep dynamic.
const SkillPicker = dynamic(
    () => import("@/components/skills/SkillPicker").then((mod) => mod.SkillPicker),
    {
        ssr: false,
        loading: () => (
            <div aria-hidden="true" className="nb-skeleton h-10 w-full rounded-lg border border-border" />
        ),
    },
);

type CoverDraft = {
    file: File;
    previewUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
};

type ProjectImageDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
};

type ScrollSnapshot = {
    routeRoot: HTMLElement | null;
    routeScrollTop: number;
    settingsRoot: HTMLElement | null;
    settingsScrollTop: number;
    windowScrollX: number;
    windowScrollY: number;
};

const PROJECT_IMAGE_MIN_ZOOM = 1;
const PROJECT_IMAGE_MAX_ZOOM = 2.5;
const PROJECT_TAG_LIMIT = 8;
const PROJECT_SKILL_LIMIT = 12;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new globalThis.Image();
        image.onload = () => resolve({
            width: image.naturalWidth || PROJECT_IMAGE_OUTPUT_SIZE,
            height: image.naturalHeight || PROJECT_IMAGE_OUTPUT_SIZE,
        });
        image.onerror = () => reject(new Error("Couldn’t read selected image"));
        image.src = src;
    });
}

function projectImagePreviewMetrics(draft: CoverDraft) {
    const baseScale = Math.max(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const width = draft.naturalWidth * baseScale * draft.zoom;
    const height = draft.naturalHeight * baseScale * draft.zoom;
    return {
        width,
        height,
        maxOffsetX: Math.max(0, (width - PROJECT_IMAGE_PREVIEW_SIZE) / 2),
        maxOffsetY: Math.max(0, (height - PROJECT_IMAGE_PREVIEW_SIZE) / 2),
    };
}

function normalizeProjectImageDraft(draft: CoverDraft, updates: Partial<Pick<CoverDraft, "zoom" | "offsetX" | "offsetY">>) {
    const zoom = clamp(updates.zoom ?? draft.zoom, PROJECT_IMAGE_MIN_ZOOM, PROJECT_IMAGE_MAX_ZOOM);
    const nextDraft = { ...draft, ...updates, zoom };
    const metrics = projectImagePreviewMetrics(nextDraft);
    return {
        ...nextDraft,
        offsetX: clamp(nextDraft.offsetX, -metrics.maxOffsetX, metrics.maxOffsetX),
        offsetY: clamp(nextDraft.offsetY, -metrics.maxOffsetY, metrics.maxOffsetY),
    };
}

function fitProjectImageDraft(draft: CoverDraft) {
    const coverScale = Math.max(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const containScale = Math.min(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const zoom = clamp(containScale / coverScale, PROJECT_IMAGE_MIN_ZOOM, PROJECT_IMAGE_MAX_ZOOM);
    return normalizeProjectImageDraft(draft, { zoom, offsetX: 0, offsetY: 0 });
}

function fillProjectImageDraft(draft: CoverDraft) {
    return normalizeProjectImageDraft(draft, {
        zoom: PROJECT_IMAGE_MIN_ZOOM,
        offsetX: 0,
        offsetY: 0,
    });
}

function captureScrollSnapshot(): ScrollSnapshot {
    const routeRoot = typeof document === "undefined"
        ? null
        : document.querySelector<HTMLElement>('[data-scroll-root="route"]');
    const settingsRoot = typeof document === "undefined"
        ? null
        : document.querySelector<HTMLElement>('[data-project-settings-document]');
    return {
        routeRoot,
        routeScrollTop: routeRoot?.scrollTop ?? 0,
        settingsRoot,
        settingsScrollTop: settingsRoot?.scrollTop ?? 0,
        windowScrollX: typeof window === "undefined" ? 0 : window.scrollX,
        windowScrollY: typeof window === "undefined" ? 0 : window.scrollY,
    };
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot | null) {
    if (!snapshot || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
        if (snapshot.routeRoot) {
            snapshot.routeRoot.scrollTop = snapshot.routeScrollTop;
        }
        if (snapshot.settingsRoot) {
            snapshot.settingsRoot.scrollTop = snapshot.settingsScrollTop;
        }
        window.scrollTo(snapshot.windowScrollX, snapshot.windowScrollY);
    });
}

function normalizeStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function areStringArraysEqual(left: string[], right: string[]) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
}

function splitProjectCategory(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return { choice: "", custom: "" };
    if (isKnownProjectType(trimmed)) return { choice: trimmed, custom: "" };
    return { choice: OTHER_PROJECT_TYPE_ID, custom: trimmed };
}

function resolveProjectCategory(choice: string, custom: string) {
    return choice === OTHER_PROJECT_TYPE_ID ? custom.trim() : choice.trim();
}

export function resetIdentityFromProject(project: any) {
    const category = typeof project?.category === "string" ? project.category : "";
    const categoryState = splitProjectCategory(category);
    return {
        title: typeof project?.title === "string" ? project.title : "",
        shortDescription:
            typeof project?.shortDescription === "string"
                ? project.shortDescription
                : typeof project?.short_description === "string"
                    ? project.short_description
                    : "",
        description: typeof project?.description === "string" ? project.description : "",
        category,
        categoryChoice: categoryState.choice,
        customCategory: categoryState.custom,
        tags: normalizeStringArray(project?.tags),
        skills: normalizeStringArray(project?.skills),
        coverImage: getProjectCoverImage(project),
    };
}

function getProjectCoverImage(project: any): string {
    const cover = project?.coverImage ?? project?.cover_image ?? project?.coverImageUrl ?? project?.cover_image_url;
    return typeof cover === "string" ? cover.trim() : "";
}

export function GeneralSettingsSection({
    projectId,
    project,
    onProjectUpdated,
    initialIdentity,
    projectTitle,
    onProjectTitleChange,
}: {
    projectId: string;
    project: any;
    onProjectUpdated: (updates?: { coverImage?: string | null }) => void;
    initialIdentity: ReturnType<typeof resetIdentityFromProject>;
    projectTitle: string;
    onProjectTitleChange: (title: string) => void;
}) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);
    const [shortDescription, setShortDescription] = useState(initialIdentity.shortDescription);
    const [description, setDescription] = useState(initialIdentity.description);
    const [identitySubmitted, setIdentitySubmitted] = useState(false);
    const [categoryChoice, setCategoryChoice] = useState(initialIdentity.categoryChoice);
    const [customCategory, setCustomCategory] = useState(initialIdentity.customCategory);
    const [tags, setTags] = useState<string[]>(initialIdentity.tags);
    const [skills, setSkills] = useState<string[]>(initialIdentity.skills);
    const [coverImage, setCoverImage] = useState(initialIdentity.coverImage);
    const [coverDraft, setCoverDraft] = useState<CoverDraft | null>(null);
    const projectImageDragRef = useRef<ProjectImageDragState | null>(null);
    const coverInputRef = useRef<HTMLInputElement | null>(null);
    const filePickerScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
    const [savedIdentity, setSavedIdentity] = useState(initialIdentity);
    const categoryValue = resolveProjectCategory(categoryChoice, customCategory);
    const identityDirty =
        projectTitle !== savedIdentity.title ||
        shortDescription !== savedIdentity.shortDescription ||
        description !== savedIdentity.description ||
        categoryValue !== savedIdentity.category ||
        !areStringArraysEqual(tags, savedIdentity.tags) ||
        !areStringArraysEqual(skills, savedIdentity.skills);
    useEffect(() => {
        // An unrelated project refresh must not replace this draft.
        if (identityDirty) return;
        setSavedIdentity(initialIdentity);
        onProjectTitleChange(initialIdentity.title);
        setShortDescription(initialIdentity.shortDescription);
        setDescription(initialIdentity.description);
        setCategoryChoice(initialIdentity.categoryChoice);
        setCustomCategory(initialIdentity.customCategory);
        setTags(initialIdentity.tags);
        setSkills(initialIdentity.skills);
    }, [initialIdentity, onProjectTitleChange]);
    useEffect(() => setCoverImage(initialIdentity.coverImage), [initialIdentity.coverImage]);
    useEffect(() => {
        return () => {
            if (coverDraft?.previewUrl) {
                URL.revokeObjectURL(coverDraft.previewUrl);
            }
        };
    }, [coverDraft?.previewUrl]);

    const restoreFilePickerScroll = useCallback(() => {
        restoreScrollSnapshot(filePickerScrollSnapshotRef.current);
    }, []);

    useEffect(() => {
        const handleWindowFocus = () => {
            if (!filePickerScrollSnapshotRef.current) return;
            restoreFilePickerScroll();
            window.setTimeout(() => {
                restoreFilePickerScroll();
                filePickerScrollSnapshotRef.current = null;
            }, 120);
        };
        window.addEventListener("focus", handleWindowFocus);
        return () => window.removeEventListener("focus", handleWindowFocus);
    }, [restoreFilePickerScroll]);

    const handleSaveGeneral = async () => {
        if (savingSettings) return;
        setIdentitySubmitted(true);
        const trimmedTitle = projectTitle.trim();
        if (!trimmedTitle) {
            toast.warning("Check required fields");
            document.getElementById("settings-project-name")?.focus();
            return;
        }
        const nextCategory = resolveProjectCategory(categoryChoice, customCategory);
        if (categoryChoice === OTHER_PROJECT_TYPE_ID && !nextCategory) {
            toast.error("Add a custom category or choose one from the dropdown");
            return;
        }
        setSavingSettings(true);
        try {
            const identityResult = await updateProject(projectId, {
                title: trimmedTitle,
                shortDescription: shortDescription.trim() || null,
                description: description.trim() || null,
                category: nextCategory || null,
                tags,
                skills,
            });
            if (!identityResult?.success) {
                toast.error("Couldn’t update workspace identity");
                return;
            }

            setSavedIdentity(resetIdentityFromProject({ title: trimmedTitle, shortDescription: shortDescription.trim(), description: description.trim(), category: nextCategory, tags: [...tags], skills: [...skills], coverImage }));
            onProjectTitleChange(trimmedTitle);
            setShortDescription(shortDescription.trim());
            setDescription(description.trim());
            toast.success("General settings updated");
            onProjectUpdated();
            broadcastProjectUpdated(projectId);
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            router.refresh();
        } catch (error) {
            console.error("Failed to save general project settings", error);
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t save general settings", "Couldn’t save general settings"));
        } finally {
            setSavingSettings(false);
        }
    };

    const handleCancelGeneral = useCallback(() => {
        onProjectTitleChange(savedIdentity.title);
        setShortDescription(savedIdentity.shortDescription);
        setDescription(savedIdentity.description);
        setCategoryChoice(savedIdentity.categoryChoice);
        setCustomCategory(savedIdentity.customCategory);
        setTags(savedIdentity.tags);
        setSkills(savedIdentity.skills);
    }, [savedIdentity, onProjectTitleChange]);

    const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        restoreFilePickerScroll();
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
        const fileType = file.type || (isGif ? "image/gif" : "");
        if (!ALLOWED_PROJECT_IMAGE_MIME_TYPES.has(fileType)) {
            toast.error("Unsupported image type", { description: "Use JPG, PNG, WebP, or GIF." });
            return;
        }

        if (file.size > PROJECT_IMAGE_UPLOAD_MAX_BYTES) {
            toast.warning(`Image must be under 2 MB. Selected file is ${(file.size / (1024 * 1024)).toFixed(1)} MB.`);
            return;
        }

        const previewUrl = URL.createObjectURL(file);
        try {
            const dimensions = await readImageDimensions(previewUrl);
            setCoverDraft((current) => {
                if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
                return {
                    file,
                    previewUrl,
                    naturalWidth: dimensions.width,
                    naturalHeight: dimensions.height,
                    zoom: PROJECT_IMAGE_MIN_ZOOM,
                    offsetX: 0,
                    offsetY: 0,
                };
            });
        } catch (error) {
            URL.revokeObjectURL(previewUrl);
            console.error("Failed to prepare project avatar preview", error);
            toast.error("Couldn’t read selected image");
        } finally {
            window.setTimeout(() => {
                restoreFilePickerScroll();
                filePickerScrollSnapshotRef.current = null;
            }, 50);
        }
    };

    const handleOpenProjectImagePicker = useCallback(() => {
        if (uploadingCoverImage) return;
        filePickerScrollSnapshotRef.current = captureScrollSnapshot();
        coverInputRef.current?.click();
        restoreFilePickerScroll();
    }, [restoreFilePickerScroll, uploadingCoverImage]);

    const updateCoverDraftTransform = useCallback((updates: Partial<Pick<CoverDraft, "zoom" | "offsetX" | "offsetY">>) => {
        setCoverDraft((current) => current ? normalizeProjectImageDraft(current, updates) : current);
    }, []);

    const handleResetProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? normalizeProjectImageDraft(current, {
            zoom: PROJECT_IMAGE_MIN_ZOOM,
            offsetX: 0,
            offsetY: 0,
        }) : current);
    }, []);

    const handleFitProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? fitProjectImageDraft(current) : current);
    }, []);

    const handleFillProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? fillProjectImageDraft(current) : current);
    }, []);

    const handleProjectImagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!coverDraft || uploadingCoverImage) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        projectImageDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: coverDraft.offsetX,
            offsetY: coverDraft.offsetY,
        };
    }, [coverDraft, uploadingCoverImage]);

    const handleProjectImagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const dragState = projectImageDragRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        event.preventDefault();
        updateCoverDraftTransform({
            offsetX: dragState.offsetX + event.clientX - dragState.startX,
            offsetY: dragState.offsetY + event.clientY - dragState.startY,
        });
    }, [updateCoverDraftTransform]);

    const handleProjectImagePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (projectImageDragRef.current?.pointerId === event.pointerId) {
            projectImageDragRef.current = null;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const projectImagePreviewMetricsValue = coverDraft ? projectImagePreviewMetrics(coverDraft) : null;

    const handlePublishCoverDraft = async () => {
        if (!coverDraft) return;
        setUploadingCoverImage(true);
        try {
            const finalized = await uploadProjectImage(projectId, coverDraft.file, {
                zoom: coverDraft.zoom,
                offsetX: coverDraft.offsetX,
                offsetY: coverDraft.offsetY,
            });

            setCoverImage(finalized.publicUrl);
            setCoverDraft(null);
            toast.success(finalized.optimized ? "Workspace avatar optimized and updated" : "Workspace avatar updated");
            onProjectUpdated({ coverImage: finalized.publicUrl });
            broadcastProjectUpdated(projectId, { coverImage: finalized.publicUrl });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            router.refresh();
        } catch (error) {
            console.error("Failed to upload project avatar", error);
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t upload workspace avatar", "Couldn’t upload workspace avatar"));
        } finally {
            setUploadingCoverImage(false);
        }
    };

    const handleCancelCoverDraft = useCallback(() => {
        setCoverDraft((current) => {
            if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
            return null;
        });
    }, []);

    const handleClearCoverImage = async () => {
        if (coverDraft) {
            handleCancelCoverDraft();
            return;
        }
        setUploadingCoverImage(true);
        try {
            const result = await clearProjectCoverImageAction(projectId);
            if (!result?.success) {
                throw new Error(result.error || "Couldn’t remove workspace avatar");
            }
            setCoverImage("");
            toast.success("Workspace avatar removed");
            onProjectUpdated({ coverImage: null });
            broadcastProjectUpdated(projectId, { coverImage: null });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            router.refresh();
        } catch (error) {
            console.error("Failed to remove project avatar", error);
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t remove workspace avatar", "Couldn’t remove workspace avatar"));
        } finally {
            setUploadingCoverImage(false);
        }
    };

    const coverImageUrl = coverImage.trim();
    const coverInputId = `project-image-${projectId}`;

    return (
    <section id="project-settings-general" data-project-settings-section className="space-y-8">
        <SettingsPageHeader level={2} title="General" description="Manage your workspace’s avatar, public identity, tags, and skills." />
        <div className="space-y-8 divide-y divide-border [&>section]:pb-6">
        <section
            data-testid="project-avatar-settings-card"
            className="space-y-4"
        >
            <div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
                        <div className="relative size-20 sm:size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
                            {coverImageUrl ? (
                                <Image
                                    src={coverImageUrl}
                                    alt={`${projectTitle || "Workspace"} avatar`}
                                    fill
                                    style={{ objectFit: "cover" }}
                                    className="object-cover"
                                    sizes="96px"
                                    unoptimized
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-muted-foreground">
                                    {(projectTitle?.[0] || "P").toUpperCase()}
                                </div>
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <h3 className="nb-card-title text-foreground">Workspace image</h3>
                            <p className="nb-compact mt-1 text-muted-foreground">
                                Square avatar displayed on workspace cards, header, and link previews.
                            </p>
                            <div className="nb-meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                                <span>JPG, PNG, WebP, GIF</span>
                                <span>•</span>
                                <span>Under 2 MB</span>
                                <span>•</span>
                                <span>Square 1:1</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center">
                        <input
                            ref={coverInputRef}
                            id={coverInputId}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            tabIndex={-1}
                            aria-hidden="true"
                            className="hidden"
                            onChange={(event) => void handleCoverImageUpload(event)}
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={uploadingCoverImage}
                                    className="rounded-md"
                                >
                                    {uploadingCoverImage ? (
                                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                                    ) : (
                                        <Camera className="mr-1.5 size-4" />
                                    )}
                                    Avatar options
                                    <ChevronDown className="ml-1.5 size-4 opacity-70" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={handleOpenProjectImagePicker}>
                                    <Upload className="mr-2 size-4" />
                                    {coverImageUrl ? "Workspace image" : "Upload avatar"}
                                </DropdownMenuItem>
                                {coverImageUrl ? (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => void handleClearCoverImage()}
                                            className="text-destructive focus:text-destructive"
                                        >
                                            <Trash2 className="mr-2 size-4" />
                                            Remove avatar
                                        </DropdownMenuItem>
                                    </>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {coverDraft ? (() => {
                    const isDraftGif = coverDraft.file.type === "image/gif" || coverDraft.file.name.toLowerCase().endsWith(".gif");
                    return (
                    <div className="mt-6 border-t border-border pt-6 space-y-4">
                        <div className="grid place-items-center rounded-lg border border-border bg-muted/20 p-4">
                            <div
                                role="img"
                                aria-label={`${projectTitle || "Workspace"} image adjustment preview`}
                                className="relative h-56 w-56 touch-none overflow-hidden rounded-lg border border-border bg-muted/40 shadow-inner"
                                onPointerDown={isDraftGif ? undefined : handleProjectImagePointerDown}
                                onPointerMove={isDraftGif ? undefined : handleProjectImagePointerMove}
                                onPointerUp={isDraftGif ? undefined : handleProjectImagePointerEnd}
                                onPointerCancel={isDraftGif ? undefined : handleProjectImagePointerEnd}
                                onLostPointerCapture={isDraftGif ? undefined : handleProjectImagePointerEnd}
                            >
                                {isDraftGif ? (
                                    <Image
                                        src={coverDraft.previewUrl}
                                        alt=""
                                        fill
                                        draggable={false}
                                        style={{ objectFit: "cover" }}
                                        className="object-cover select-none"
                                        unoptimized
                                    />
                                ) : (
                                    <Image
                                        src={coverDraft.previewUrl}
                                        alt=""
                                        draggable={false}
                                        className="absolute left-1/2 top-1/2 max-w-none select-none"
                                        width={projectImagePreviewMetricsValue?.width ?? PROJECT_IMAGE_PREVIEW_SIZE}
                                        height={projectImagePreviewMetricsValue?.height ?? PROJECT_IMAGE_PREVIEW_SIZE}
                                        style={{
                                            transform: `translate(calc(-50% + ${coverDraft.offsetX}px), calc(-50% + ${coverDraft.offsetY}px))`,
                                        }}
                                        unoptimized
                                    />
                                )}
                                <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-foreground/10" />
                            </div>
                        </div>
                        {isDraftGif ? (
                            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
                                <span className="font-semibold text-foreground">Animated GIF · 1:1 Direct Upload</span>
                                <span className="text-muted-foreground">Original frames and motion preserved</span>
                            </div>
                        ) : (
                            <div className="grid gap-3">
                                <div className="flex flex-wrap items-center justify-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleResetProjectImageDraft}
                                        disabled={uploadingCoverImage}
                                        className="nb-touch-target h-[28px] rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                                    >
                                        Reset
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleFitProjectImageDraft}
                                        disabled={uploadingCoverImage}
                                        className="nb-touch-target h-[28px] rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                                    >
                                        Fit
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleFillProjectImageDraft}
                                        disabled={uploadingCoverImage}
                                        className="nb-touch-target h-[28px] rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                                    >
                                        Fill
                                    </Button>
                                </div>
                                <label className="grid gap-2">
                                    <span className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                                        <span>Zoom</span>
                                        <span className="rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] text-muted-foreground uppercase tracking-[0.09em]">
                                            Drag image to position
                                        </span>
                                    </span>
                                    <input
                                        type="range"
                                        min={PROJECT_IMAGE_MIN_ZOOM}
                                        max={PROJECT_IMAGE_MAX_ZOOM}
                                        step={0.01}
                                        value={coverDraft.zoom}
                                        onChange={(event) => {
                                            const next = Number(event.target.value);
                                            updateCoverDraftTransform({ zoom: next });
                                        }}
                                        className="accent-primary"
                                    />
                                </label>
                            </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                            <p className="nb-compact text-muted-foreground">
                                {isDraftGif
                                    ? "Animated GIF will be saved in full motion without lossy compression or frame flattening."
                                    : "Drag and zoom before publishing. The saved square avatar powers cards and link previews."}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCancelCoverDraft}
                                    disabled={uploadingCoverImage}
                                    className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => void handlePublishCoverDraft()}
                                    disabled={uploadingCoverImage}
                                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                >
                                    {uploadingCoverImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Save avatar
                                </Button>
                            </div>
                        </div>
                    </div>
                    );
                })() : null}
            </div>
        </section>

        <SettingsCard
            title="Workspace or workspace"
            description="Shown in the workspace page, cards, search and notifications."

        >
            <fieldset disabled={savingSettings} className="min-w-0 divide-y divide-border">
                <div className="pb-6">
                    <ReadOnlySlugField slug={project?.slug ?? ""} />
                </div>
                <div className="py-6">
                    <TextField
                        id="settings-project-name"
                        error={identitySubmitted && !projectTitle.trim() ? "Workspace name is required." : undefined}
                        label="Workspace name"
                        description="The public title shown in headers, cards, and search."
                        value={projectTitle}
                        onChange={onProjectTitleChange}
                        placeholder="Workspace name"
                    />
                </div>
                <div className="py-6">
                    <TextField
                        label="Summary"
                        description="A one-line workspace summary for cards and search previews (recommended under 160 characters)."
                        value={shortDescription}
                        onChange={setShortDescription}
                        placeholder="A one-line workspace summary"
                    />
                </div>
                <div className="py-6">
                    <TextAreaField
                        label="Description"
                        description="Detailed overview explaining what this workspace does and why it matters."
                        value={description}
                        onChange={setDescription}
                        placeholder="Describe what this workspace does and why it matters"
                    />
                </div>
                <div className="pt-6">
                    <CategorySelector
                        choice={categoryChoice}
                        customValue={customCategory}
                        onChoiceChange={setCategoryChoice}
                        onCustomChange={setCustomCategory}
                        description="Primary category to help people discover your workspace."
                    />
                </div>
            </fieldset>
        </SettingsCard>

        <SettingsCard
            title="Tags and skills"
            description="Select the technologies and professional disciplines associated with this workspace."
            footer={
                <>
                    <p className="nb-compact text-muted-foreground">
                        {identityDirty ? "You have unsaved changes in General settings." : "All General settings are saved."}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCancelGeneral}
                            disabled={!identityDirty || savingSettings}
                            className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSaveGeneral()}
                            disabled={!identityDirty || savingSettings}
                            className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            {savingSettings ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                            Save changes
                        </Button>
                    </div>
                </>
            }
        >
            <fieldset disabled={savingSettings} className="min-w-0 divide-y divide-border">
                <div className="pb-6">
                    <ChipEditor
                        label="Tags"
                        description="Keyword tags used for search indexing and discovery filters (up to 8 tags)."
                        values={tags}
                        onChange={setTags}
                        suggestions={POPULAR_PROJECT_TAGS}
                        placeholder="Add a tag"
                        limit={PROJECT_TAG_LIMIT}
                    />
                </div>
                <div className="pt-6">
                    <SkillPicker
                        value={skills}
                        onChange={setSkills}
                        maxSkills={PROJECT_SKILL_LIMIT}
                        label="Workspace skills and technologies"
                        description="Select the technologies and professional skills used by this workspace (up to 12 skills)."
                    />
                </div>
            </fieldset>
        </SettingsCard>
        </div>
    </section>
    );
}
