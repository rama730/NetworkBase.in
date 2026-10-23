"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import {
    ChevronDown,
    ChevronUp,
    Globe2,
    ImagePlus,
    Link2,
    ListTodo,
    Loader2,
    Paperclip,
    RefreshCw,
    Timer,
    Users,
    X,
} from "lucide-react";
import { toast } from "@/lib/feedback";
import { useLinkPreview } from "@/hooks/useLinkPreview";
import { MultiAttachmentPicker } from "@/components/projects/v2/files-tab/picker/MultiAttachmentPicker";

import { createProjectUpdateMediaUploadUrlAction, finalizeProjectUpdateMediaUploadAction, readProjectUpdateContextOptionsAction, readProjectUpdateDraftAction, saveProjectUpdateDraftAction } from "@/app/actions/project/updates";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { queryKeys } from "@/lib/query-keys";
import {
    PROJECT_UPDATE_MAX_MEDIA_ITEMS,
    PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_UPDATE_MEDIA_MAX_BYTES,
    isSafeProjectUpdateUrl,
    normalizeProjectUpdateMediaItems,
    normalizeProjectUpdateReferences,
    projectUpdateDraftStorageKey,
    projectUpdateExcerpt,
    type ProjectUpdateContextKind,
    type ProjectUpdateContextOption,
    type ProjectUpdateEntityRefs,
    type ProjectUpdateMediaItem,
    type ProjectUpdateReference,
    type ProjectUpdateVisibility,
} from "@/lib/projects/updates";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { cn } from "@/lib/utils";
import { normalizeReadmeReferenceLabel } from "@/lib/projects/doc-blocks";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

import { ProjectUpdateMediaFrame, isProjectUpdateVideoMedia } from "./ProjectUpdateMediaFrame";
import { ProjectUpdateRichTextEditor } from "./ProjectUpdateRichTextEditor";
import { ComposerReferenceOptions } from "./ComposerReferenceOptions";

const EMPTY_REFS: ProjectUpdateEntityRefs = {};
const EMPTY_CONTEXT_OPTIONS: Record<ProjectUpdateContextKind, ProjectUpdateContextOption[]> = {
    task: [],
    sprint: [],
    file: [],
};
type ComposerPanel = ProjectUpdateContextKind | "link" | null;
type PendingMediaUpload = {
    id: string;
    fileName: string;
    previewUrl: string;
    altText: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    phase: "preparing" | "uploading" | "finalizing";
    progress: number;
    error: string | null;
};

function isProjectContextPanel(panel: ComposerPanel): panel is ProjectUpdateContextKind {
    return panel === "task" || panel === "sprint" || panel === "file";
}

function refKeyForContextKind(kind: ProjectUpdateContextKind): "taskId" | "sprintId" | "fileId" {
    if (kind === "task") return "taskId";
    if (kind === "sprint") return "sprintId";
    return "fileId";
}

function assignLegacyContextRef(
    refs: ProjectUpdateEntityRefs,
    kind: ProjectUpdateContextKind,
    id: string | null,
) {
    if (kind === "task") refs.taskId = id;
    else if (kind === "sprint") refs.sprintId = id;
    else refs.fileId = id;
}

function hasEntityReferences(refs: ProjectUpdateEntityRefs) {
    return Boolean(
        normalizeProjectUpdateReferences(refs.references).length > 0 ||
            refs.taskId ||
            refs.sprintId ||
            refs.fileId ||
            refs.readmeVersionId ||
            refs.roleId ||
            refs.milestoneId,
    );
}

function formatFileSize(bytes: number | null | undefined) {
    const value = Number(bytes ?? 0);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultAltText(file: File) {
    return file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Project update image";
}

function newUploadId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    if (!file.type.startsWith("image/")) return Promise.resolve(null);
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const image = new globalThis.Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        image.src = url;
    });
}

function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith("image/")) return Promise.resolve(file);
    return new Promise((resolve) => {
        const img = new globalThis.Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            const canvas = document.createElement("canvas");
            const maxDim = 1600;
            let width = img.naturalWidth;
            let height = img.naturalHeight;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                resolve(file);
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (blob) {
                    const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
                        type: "image/webp",
                        lastModified: Date.now()
                    });
                    if (compressedFile.size < file.size) {
                        resolve(compressedFile);
                    } else {
                        resolve(file);
                    }
                } else {
                    resolve(file);
                }
            }, "image/webp", 0.8);
        };
        img.onerror = () => {
            resolve(file);
        };
    });
}

export function ProjectUpdateComposer({
    projectId,
    projectName,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    canCreate,
    canManage,
    isPosting,
    onPost,
}: {
    projectId: string;
    projectName: string;
    currentUserId: string | null;
    currentUserName?: string | null;
    currentUserAvatarUrl?: string | null;
    canCreate: boolean;
    canManage: boolean;
    isPosting: boolean;
    onPost: (input: {
        content: string;
        updateType: null;
        visibility: ProjectUpdateVisibility;
        entityRefs: ProjectUpdateEntityRefs;
    media: ProjectUpdateMediaItem[];
    }) => void;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const pendingMediaUploadsRef = useRef<PendingMediaUpload[]>([]);
    const [content, setContent] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [visibility, setVisibility] = useState<ProjectUpdateVisibility>("public");
    const [entityRefs, setEntityRefs] = useState<ProjectUpdateEntityRefs>(EMPTY_REFS);
    const [media, setMedia] = useState<ProjectUpdateMediaItem[]>([]);
    const [pendingMediaUploads, setPendingMediaUploads] = useState<PendingMediaUpload[]>([]);
    const [activePanel, setActivePanel] = useState<ComposerPanel>(null);
    const [filePickerOpen, setFilePickerOpen] = useState(false);
    const editorRef = useRef<{ insertTextAtCursor: (t: string) => void } | null>(null);

    const [contextQuery, setContextQuery] = useState("");
    const [debouncedContextQuery] = useDebounce(contextQuery, 250);
    const [mediaUrl, setMediaUrl] = useState("");
    const [mediaLabel, setMediaLabel] = useState("");
    const [linkDebouncedUrl] = useDebounce(mediaUrl.trim(), 350);

    const normalizedPreviewUrl = useMemo(() => {
        if (!linkDebouncedUrl) return null;
        try {
            const withProtocol = /^https?:\/\//i.test(linkDebouncedUrl)
                ? linkDebouncedUrl
                : `https://${linkDebouncedUrl}`;
            const parsed = new URL(withProtocol);
            if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
            return parsed.toString();
        } catch {
            return null;
        }
    }, [linkDebouncedUrl]);

    const linkPreviewQuery = useLinkPreview(normalizedPreviewUrl);
    const linkPreview = linkPreviewQuery.data;
    const draftStorageKey = useMemo(() => projectUpdateDraftStorageKey(projectId, currentUserId), [currentUserId, projectId]);
    const lastSavedDraftRef = useRef<string | null>(null);

    const activeContextKind = isProjectContextPanel(activePanel) ? activePanel : null;
    const remaining = 2_000 - content.length;
    const hasPendingUploads = pendingMediaUploads.some((item) => !item.error);
    const draftPreview = projectUpdateExcerpt(content, 240);
    const normalizedReferences = useMemo(
        () => normalizeProjectUpdateReferences(entityRefs.references),
        [entityRefs.references],
    );

    const contextOptionsQuery = useQuery({
        queryKey: queryKeys.project.detail.updateContextOptions(projectId, activeContextKind ?? "task", debouncedContextQuery),
        queryFn: async () => {
            const result = await readProjectUpdateContextOptionsAction(projectId, {
                kind: activeContextKind ?? "task",
                query: debouncedContextQuery,
                limit: 8,
            });
            if (!result.success) throw new Error(result.error || "Failed to load context");
            return result.data;
        },
        enabled: expanded && canCreate && Boolean(activeContextKind),
        staleTime: 30_000,
    });
    const contextOptions = contextOptionsQuery.data ?? EMPTY_CONTEXT_OPTIONS;
    const activeContextOptions = activeContextKind ? contextOptions[activeContextKind] : [];
    const hasMeaningfulUpdate = Boolean(content.trim() || normalizedReferences.length > 0 || media.length > 0);
    const disabled = !hasMeaningfulUpdate || hasPendingUploads || remaining < 0 || isPosting;

    const draftQuery = useQuery({
        queryKey: queryKeys.project.detail.updateDraft(projectId, currentUserId ?? ""),
        queryFn: async () => {
            if (!currentUserId) return null;
            const result = await readProjectUpdateDraftAction(projectId);
            if (!result.success) return null;
            return result.data;
        },
        enabled: canCreate && Boolean(currentUserId),
    });

    const saveDraftMutation = useMutation({
        mutationFn: async (input: Parameters<typeof saveProjectUpdateDraftAction>[1]) => {
            const result = await saveProjectUpdateDraftAction(projectId, input);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
    });
    const saveDraft = saveDraftMutation.mutate;

    // We keep track if we have initialized the editor with the draft.
    const [draftInitialized, setDraftInitialized] = useState(false);

    useEffect(() => {
        if (!canCreate || draftInitialized || !draftQuery.isFetched) return;
        
        let cancelled = false;
        async function initDraft() {
            let parsed = draftQuery.data;
            try {
                const localDraft = await idbGet(draftStorageKey);
                if (localDraft) {
                    parsed = typeof localDraft === "string" ? JSON.parse(localDraft) : localDraft;
                }
            } catch (err) {
                console.warn("Failed to read draft from IndexedDB:", err);
            }
            if (cancelled) return;

            let initialContent = "";
            let initialVisibility: ProjectUpdateVisibility = "public";
            let initialEntityRefs: ProjectUpdateEntityRefs = {};
            let initialMedia: ProjectUpdateMediaItem[] = [];
            if (parsed && typeof parsed.content === "string") {
                const draftText = parsed.content.slice(0, 2_200);
                initialContent = draftText;
                setContent(draftText);
            }
            if (parsed && (parsed.visibility === "members" || parsed.visibility === "public")) {
                initialVisibility = parsed.visibility as ProjectUpdateVisibility;
                setVisibility(initialVisibility);
            }
            if (parsed?.entityRefs && typeof parsed.entityRefs === "object") {
                initialEntityRefs = parsed.entityRefs as ProjectUpdateEntityRefs;
                setEntityRefs(initialEntityRefs);
            }
            if (Array.isArray(parsed?.media)) {
                initialMedia = normalizeProjectUpdateMediaItems(parsed.media);
                setMedia(initialMedia);
            }
            lastSavedDraftRef.current = JSON.stringify({
                content: initialContent,
                visibility: initialVisibility,
                updateType: null,
                entityRefs: initialEntityRefs,
                media: initialMedia,
            });

            setDraftInitialized(true);
        }

        initDraft();
        return () => {
            cancelled = true;
        };
    }, [canCreate, draftInitialized, draftQuery.data, draftQuery.isFetched, draftStorageKey]);

    useEffect(() => {
        if (!canCreate || !draftInitialized) return;
        const hasDraft = content.trim() || hasEntityReferences(entityRefs) || media.length > 0 || visibility !== "public";
        const payload = {
            content: hasDraft ? content : "",
            visibility: hasDraft ? visibility : "public",
            updateType: null,
            entityRefs: hasDraft ? entityRefs : {},
            media: hasDraft ? media : [],
        };
        if (typeof window !== "undefined") {
            window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
            void idbSet(draftStorageKey, payload).catch((err) => {
                console.warn("Failed to save draft to IndexedDB:", err);
            });
        }
    }, [canCreate, draftInitialized, content, entityRefs, media, visibility, draftStorageKey]);

    useEffect(() => {
        if (!canCreate || !draftInitialized) return;
        const hasDraft = content.trim() || hasEntityReferences(entityRefs) || media.length > 0 || visibility !== "public";
        const payload = {
            content: hasDraft ? content : "",
            visibility: hasDraft ? visibility : "public",
            updateType: null,
            entityRefs: hasDraft ? entityRefs : {},
            media: hasDraft ? media : [],
        };
        const serializedPayload = JSON.stringify(payload);
        if (lastSavedDraftRef.current === serializedPayload) return;
        
        const timer = setTimeout(() => {
            lastSavedDraftRef.current = serializedPayload;
            saveDraft(payload);
        }, 8000);
        
        return () => clearTimeout(timer);
    }, [canCreate, draftInitialized, content, entityRefs, media, saveDraft, visibility]);

    useEffect(() => {
        if (!canCreate || !draftInitialized) return;
        const handleSync = () => {
            const hasDraft = content.trim() || hasEntityReferences(entityRefs) || media.length > 0 || visibility !== "public";
            const payload = {
                content: hasDraft ? content : "",
                visibility: hasDraft ? visibility : "public",
                updateType: null,
                entityRefs: hasDraft ? entityRefs : {},
                media: hasDraft ? media : [],
            };
            const serializedPayload = JSON.stringify(payload);
            if (lastSavedDraftRef.current !== serializedPayload) {
                lastSavedDraftRef.current = serializedPayload;
                saveDraft(payload);
            }
        };

        window.addEventListener("blur", handleSync);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                handleSync();
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.removeEventListener("blur", handleSync);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [canCreate, draftInitialized, content, entityRefs, media, saveDraft, visibility]);

    useEffect(() => {
        if (!expanded) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (containerRef.current?.contains(target)) return;

            // Walk up the DOM to see if it is inside a portalled modal
            let curr: Node | null = target;
            let insidePortal = false;
            while (curr) {
                if (curr instanceof Element && curr.getAttribute("data-composer-portal") === "true") {
                    insidePortal = true;
                    break;
                }
                curr = curr.parentNode;
            }
            if (insidePortal) return;

            setExpanded(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [expanded]);

    useEffect(() => {
        pendingMediaUploadsRef.current = pendingMediaUploads;
    }, [pendingMediaUploads]);

    useEffect(() => {
        return () => {
            pendingMediaUploadsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        };
    }, []);

    // Parse references from content dynamically to keep entityRefs in sync
    useEffect(() => {
        const parseContent = () => {
            const parsedRefs: ProjectUpdateReference[] = Array.from(content.matchAll(/\{%\s*ref\.([a-z_]+)\s+id="([^"]+)"(?:\s+label="([^"]*)")?\s*%\}/gi)).flatMap((match) => {
                const pluralKind = match[1]?.toLowerCase();
                const id = match[2];
                if (!id) return [];
                const kind: ProjectUpdateContextKind = pluralKind === "tasks" ? "task" : pluralKind === "sprints" ? "sprint" : "file";
                return [{ kind, id }];
            });

            // Unique references
            const uniqueRefs = parsedRefs.filter(
                (ref, index, self) => self.findIndex((r) => r.kind === ref.kind && r.id === ref.id) === index
            );

            const currentRefs = entityRefs.references || [];
            const isSame = uniqueRefs.length === currentRefs.length &&
                uniqueRefs.every((ur) => currentRefs.some((cr) => cr.kind === ur.kind && cr.id === ur.id));

            if (!isSame) {
                setEntityRefs((current) => {
                    const next: ProjectUpdateEntityRefs = {
                        ...current,
                        references: uniqueRefs,
                    };
                    // Set legacy context references if any match
                    const taskRef = uniqueRefs.find((r) => r.kind === "task");
                    const sprintRef = uniqueRefs.find((r) => r.kind === "sprint");
                    const fileRef = uniqueRefs.find((r) => r.kind === "file");
                    next.taskId = taskRef?.id ?? null;
                    next.sprintId = sprintRef?.id ?? null;
                    next.fileId = fileRef?.id ?? null;
                    return next;
                });
            }
        };

        // Throttle parsing to 250ms of idle time
        const timer = setTimeout(() => {
            if (typeof window !== "undefined" && "requestIdleCallback" in window) {
                window.requestIdleCallback(() => parseContent());
            } else {
                parseContent();
            }
        }, 250);

        return () => clearTimeout(timer);
    }, [content, entityRefs.references]);


    if (!canCreate) return null;

    const openPanel = (panel: Exclude<ComposerPanel | "media" | "file", null>) => {
        setExpanded(true);
        if (panel === "media") {
            imageInputRef.current?.click();
            return;
        }
        if (panel === "file") {
            setFilePickerOpen(true);
            return;
        }
        setContextQuery("");
        setActivePanel((current) => current === panel ? null : panel as ComposerPanel);
    };

    const addContextReference = (kind: ProjectUpdateContextKind, id: string) => {
        setEntityRefs((current) => {
            const references = normalizeProjectUpdateReferences([
                ...(current.references ?? []),
                { kind, id },
            ]);
            const next: ProjectUpdateEntityRefs = { ...current, references };
            assignLegacyContextRef(next, kind, id);
            return next;
        });
    };

    const selectContext = (option: ProjectUpdateContextOption) => {
        const pluralKind = option.kind === "task" ? "tasks" : option.kind === "sprint" ? "sprints" : "files";
        const normalizedLabel = normalizeReadmeReferenceLabel(pluralKind, option.label);
        const escapedLabel = normalizedLabel.replace(/\\/g, "\\\\").replace(/"/g, "&quot;").replace(/\s+/g, " ").trim();
        const refText = `{% ref.${pluralKind} id="${option.id}" label="${escapedLabel}" %}`;
        if (editorRef.current) {
            editorRef.current.insertTextAtCursor(refText);
        }
        addContextReference(option.kind, option.id);
        setActivePanel(null);
    };

    const removeMedia = (index: number) => {
        setMedia((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };

    const addMediaFromPanel = (type: ProjectUpdateMediaItem["type"]) => {
        let url = mediaUrl.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) {
            url = `https://${url}`;
        }
        if (!isSafeProjectUpdateUrl(url)) {
            toast.error("Use a valid http or https link.");
            return;
        }
        if (media.length >= PROJECT_UPDATE_MAX_MEDIA_ITEMS) {
            toast.error(`You can attach up to ${PROJECT_UPDATE_MAX_MEDIA_ITEMS} items.`);
            return;
        }
        const effectiveLabel = mediaLabel.trim() || linkPreview?.title || linkPreview?.domain || url;
        setMedia((current) => [...current, { type, url, label: effectiveLabel }]);
        setMediaUrl("");
        setMediaLabel("");
        setActivePanel(null);
    };

    const updatePendingUpload = (id: string, patch: Partial<PendingMediaUpload>) => {
        setPendingMediaUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    };

    const clearPendingUpload = (id: string) => {
        setPendingMediaUploads((current) => {
            const target = current.find((item) => item.id === id);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return current.filter((item) => item.id !== id);
        });
    };

    const uploadImageFile = async (originalFile: File) => {
        if (!PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has(originalFile.type)) {
            toast.error("Use JPG, PNG, WebP, or GIF images.");
            return;
        }
        if (originalFile.size > PROJECT_UPDATE_MEDIA_MAX_BYTES) {
            toast.error(`Update images must be ${formatFileSize(PROJECT_UPDATE_MEDIA_MAX_BYTES)} or smaller.`);
            return;
        }
        if (media.length + pendingMediaUploads.length >= PROJECT_UPDATE_MAX_MEDIA_ITEMS) {
            toast.error(`You can attach up to ${PROJECT_UPDATE_MAX_MEDIA_ITEMS} items.`);
            return;
        }
        setExpanded(true);
        const id = newUploadId();
        const previewUrl = URL.createObjectURL(originalFile);
        const altText = defaultAltText(originalFile);

        setPendingMediaUploads((current) => [
            ...current,
            {
                id,
                fileName: originalFile.name,
                previewUrl,
                altText,
                mimeType: originalFile.type,
                size: originalFile.size,
                width: null,
                height: null,
                phase: "preparing",
                progress: 15,
                error: null,
            },
        ]);
        try {
            const file = await compressImage(originalFile);
            const dimensions = await readImageDimensions(file);
            updatePendingUpload(id, {
                fileName: file.name,
                mimeType: file.type,
                size: file.size,
                width: dimensions?.width ?? null,
                height: dimensions?.height ?? null,
                progress: 30,
            });

            if (file.size > PROJECT_UPDATE_MEDIA_MAX_BYTES) {
                throw new Error(`Compressed image exceeds max size.`);
            }

            const prepared = await createProjectUpdateMediaUploadUrlAction(projectId, {
                mimeType: file.type,
                sizeBytes: file.size,
                altText,
            });
            if (!prepared.success) throw new Error(prepared.error);
            updatePendingUpload(id, { phase: "uploading", progress: 58 });
            await uploadToSupabaseSignedUrl({
                bucket: prepared.bucket,
                storagePath: prepared.storagePath,
                uploadToken: prepared.uploadToken,
                uploadUrl: prepared.uploadUrl,
                contentType: prepared.contentType,
                operationId: prepared.uploadIntentId,
            }, file, { cacheProfile: "immutable" });
            updatePendingUpload(id, { phase: "finalizing", progress: 88 });
            const finalized = await finalizeProjectUpdateMediaUploadAction(projectId, {
                uploadIntentId: prepared.uploadIntentId,
                altText,
                label: file.name,
                width: dimensions?.width ?? null,
                height: dimensions?.height ?? null,
            });
            if (!finalized.success) throw new Error(finalized.error);
            setMedia((current) => [...current, finalized.media]);
            clearPendingUpload(id);
        } catch (error) {
            updatePendingUpload(id, {
                phase: "preparing",
                progress: 0,
                error: error instanceof Error ? error.message : "Failed to upload image.",
            });
        }
    };

    const handleImageFiles = (files: FileList | File[] | null | undefined) => {
        const selectedFiles = Array.from(files ?? []);
        if (selectedFiles.length === 0) return;
        const remainingSlots = PROJECT_UPDATE_MAX_MEDIA_ITEMS - media.length - pendingMediaUploads.length;
        if (remainingSlots <= 0) {
            toast.error(`You can attach up to ${PROJECT_UPDATE_MAX_MEDIA_ITEMS} items.`);
            return;
        }
        selectedFiles.slice(0, remainingSlots).forEach((file) => {
            void uploadImageFile(file);
        });
        if (selectedFiles.length > remainingSlots) {
            toast.error(`Only ${remainingSlots} more ${remainingSlots === 1 ? "image" : "images"} can be attached.`);
        }
    };

    const resetAfterPost = () => {
        setContent("");
        setEntityRefs(EMPTY_REFS);
        setMedia([]);
        pendingMediaUploads.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        setPendingMediaUploads([]);
        setExpanded(false);
        setActivePanel(null);
        setMediaUrl("");
        setMediaLabel("");
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(draftStorageKey);
            void idbDel(draftStorageKey).catch((err) => {
                console.warn("Failed to delete draft from IndexedDB:", err);
            });
        }
        if (!canManage) setVisibility("public");
        lastSavedDraftRef.current = JSON.stringify({ content: "", visibility: "public", updateType: null, entityRefs: {}, media: [] });
    };

    const toolbarButtonClass = "size-7 rounded-[5px] flex items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border";
    const bottomPanel = expanded && activePanel ? (
        <div className={cn(
            "mt-3 rounded-[8px] border border-border bg-card p-3 shadow-none",
        )}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-foreground">
                        {activePanel === "link"
                            ? "Attach link"
                            : activePanel === "task"
                            ? "Task context"
                            : activePanel === "sprint"
                            ? "Sprint context"
                            : "File context"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {activePanel === "link"
                            ? "Add one supporting reference to this update."
                            : activePanel === "task"
                            ? "Connect this post to active project work."
                            : activePanel === "sprint"
                            ? "Connect this post to active project work."
                            : "Connect this post to active project work."}
                    </p>
                </div>
                <button type="button" onClick={() => setActivePanel(null)} className="nb-touch-target size-7 rounded-[5px] flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Close composer panel">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {activeContextKind ? (
                <ComposerReferenceOptions
                    key={activeContextKind}
                    query={contextQuery}
                    onQueryChange={setContextQuery}
                    placeholder={`Find ${activeContextKind}`}
                    options={activeContextOptions}
                    loading={contextOptionsQuery.isLoading}
                    error={contextOptionsQuery.isError ? "Could not load project context." : null}
                    onRetry={() => { void contextOptionsQuery.refetch(); }}
                    onSelect={selectContext}
                    onClose={() => setActivePanel(null)}
                    selectedId={entityRefs[refKeyForContextKind(activeContextKind)]}
                />
            ) : (
                <div className="grid gap-2.5">
                    <div>
                        <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                            Link address
                        </label>
                        <input
                            value={mediaUrl}
                            onChange={(event) => setMediaUrl(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    addMediaFromPanel("link");
                                }
                            }}
                            placeholder="Paste URL here (e.g. https://github.com/org/repo)"
                            inputMode="url"
                            autoComplete="url"
                            className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] outline-none transition focus:border-foreground/30 placeholder:text-muted-foreground"
                        />
                    </div>

                    {normalizedPreviewUrl ? (
                        <div className="rounded-[6px] border border-border bg-muted/20 p-2.5 text-xs">
                            {linkPreviewQuery.isFetching ? (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                                    <span>Identifying destination…</span>
                                </div>
                            ) : linkPreview?.title ? (
                                <div className="space-y-1">
                                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                                        <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{linkPreview.title}</span>
                                    </div>
                                    {linkPreview.description ? (
                                        <p className="line-clamp-2 text-[11px] text-muted-foreground leading-relaxed">
                                            {linkPreview.description}
                                        </p>
                                    ) : null}
                                    <span className="block font-mono text-[10px] max-md:text-[11px] text-muted-foreground">
                                        {linkPreview.domain}
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                    <Globe2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{normalizedPreviewUrl}</span>
                                </div>
                            )}
                        </div>
                    ) : null}

                    <div>
                        <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                            Display name
                        </label>
                        <div className="flex gap-2">
                            <input
                                value={mediaLabel}
                                onChange={(event) => setMediaLabel(event.target.value.slice(0, 160))}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        addMediaFromPanel("link");
                                    }
                                }}
                                placeholder={
                                    linkPreviewQuery.isFetching
                                        ? "Finding destination name…"
                                        : linkPreview?.title || "Display name (optional)"
                                }
                                className="nb-touch-target h-[34px] flex-1 rounded-[5px] border border-border bg-background px-3 text-[13px] outline-none transition focus:border-foreground/30 placeholder:text-muted-foreground"
                            />
                            {linkPreviewQuery.isFetching ? (
                                <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[5px] border border-border bg-muted/30 text-muted-foreground">
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="nb-touch-target h-[32px] rounded-[5px] border-border px-3 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => {
                                setMediaUrl("");
                                setMediaLabel("");
                                setActivePanel(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="nb-touch-target h-[32px] rounded-[5px] px-3 text-[12px] font-medium"
                            disabled={!mediaUrl.trim()}
                            onClick={() => addMediaFromPanel("link")}
                        >
                            Attach link
                        </Button>
                    </div>
                </div>
            )}
        </div>
    ) : null;

    const hiddenImageInput = (
        <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            multiple
            onChange={(event) => {
                handleImageFiles(event.target.files);
                event.currentTarget.value = "";
            }}
        />
    );

    const composerBody = (
        <div className="flex gap-3 relative">
            <UserAvatar
                identity={{ fullName: currentUserName ?? "You", avatarUrl: currentUserAvatarUrl ?? null }}
                size={34}
                className="mt-1"
            />
            <div className="min-w-0 flex-1">
                <div className="absolute right-0 top-0">
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="nb-touch-target size-7 rounded-[5px] flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label={expanded ? "Collapse composer" : "Expand composer"}
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>
                {!expanded ? (
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="block min-h-11 w-[calc(100%-32px)] rounded-[6px] border border-border bg-card/60 p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40 focus:outline-none"
                        aria-expanded={expanded}
                    >
                        <span className={cn(
                            "block truncate text-[13px]",
                            draftPreview ? "text-foreground font-medium" : "text-muted-foreground",
                        )}>
                            {draftPreview || `Share a project update for ${projectName}...`}
                        </span>
                        {draftPreview ? (
                            <span className="mt-1 inline-block font-mono text-[10px] max-md:text-[11px] font-semibold uppercase tracking-[0.09em] text-primary">Draft saved</span>
                        ) : null}
                    </button>
                ) : (
                    <>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setVisibility((current) => current === "public" ? "members" : "public")}
                                className="inline-flex items-center gap-1.5 rounded-[3px] border border-border bg-muted/40 px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground transition hover:border-foreground/30 hover:bg-muted"
                            >
                                {visibility === "public" ? <Globe2 className="h-3.5 w-3.5 text-muted-foreground" /> : <Users className="h-3.5 w-3.5 text-muted-foreground" />}
                                {visibility === "public" ? "Public" : "Project members"}
                            </button>
                        </div>
                        <div className="rounded-[8px] border border-border bg-card p-3 transition focus-within:border-foreground/30">
                            <ProjectUpdateRichTextEditor
                                content={content}
                                placeholder={`Share a project update for ${projectName}...`}
                                onChange={setContent}
                                onCommand={openPanel}
                                onMention={() => openPanel("task")}
                                editorRef={editorRef}
                            />
                        </div>
                    </>
                )}

                {expanded && (media.length > 0 || pendingMediaUploads.length > 0) ? (
                    <div className="mt-3 space-y-2">
                        {pendingMediaUploads.map((item) => (
                            <ProjectUpdateMediaFrame
                                key={item.id}
                                item={{
                                    type: "image",
                                    url: item.previewUrl,
                                    label: item.fileName,
                                    altText: item.altText,
                                    mimeType: item.mimeType,
                                    width: item.width,
                                    height: item.height,
                                }}
                                src={item.previewUrl}
                                alt={item.altText || item.fileName}
                                actions={(
                                    <>
                                        <button type="button" onClick={() => clearPendingUpload(item.id)} className="absolute right-2 top-2 size-6 rounded-[3px] flex items-center justify-center bg-foreground/80 p-1 text-background hover:bg-foreground transition-colors" aria-label="Remove image">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                        <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-[3px] border border-border/50 bg-background/90 px-2 py-0.5 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.09em] text-foreground shadow-sm">
                                            {item.error
                                                ? "Upload failed"
                                                : `${item.phase} · ${item.progress}%`}
                                        </div>
                                    </>
                                )}
                            />
                        ))}
                        {media.map((item, index) => item.url && (item.type === "image" || isProjectUpdateVideoMedia(item)) ? (
                            <ProjectUpdateMediaFrame
                                key={`${item.url}-${index}`}
                                item={item}
                                src={item.url}
                                alt={item.altText || item.label || "Project update image"}
                                actions={(
                                    <button type="button" className="absolute right-2 top-2 size-6 rounded-[3px] flex items-center justify-center bg-foreground/80 p-1 text-background hover:bg-foreground transition-colors" onClick={() => removeMedia(index)} aria-label="Remove image">
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            />
                        ) : (
                            <div key={`${item.url}-${index}`} className="flex min-w-0 items-center gap-2.5 rounded-[6px] border border-border bg-card px-3 py-2">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] bg-muted/60 text-muted-foreground">
                                    <Link2 className="h-3.5 w-3.5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-medium text-foreground">{item.label || item.url || "Linked reference"}</span>
                                    {item.url && item.label && item.label !== item.url ? (
                                        <span className="block truncate font-mono text-[11px] text-muted-foreground">{item.url}</span>
                                    ) : null}
                                </div>
                                <button type="button" className="size-6 rounded-[3px] flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={() => removeMedia(index)} aria-label="Remove media">
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}

                {expanded ? (
                    <>
                        {bottomPanel}
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                            <div className="flex items-center gap-1 shrink-0">
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("task")} title="Task context" aria-label="Task context" aria-pressed={activePanel === "task"}>
                                    <ListTodo className="h-4 w-4" />
                                </button>
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("sprint")} title="Sprint context" aria-label="Sprint context" aria-pressed={activePanel === "sprint"}>
                                    <Timer className="h-4 w-4" />
                                </button>
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("file")} title="File context" aria-label="File context" aria-pressed={activePanel === "file"}>
                                    <Paperclip className="h-4 w-4" />
                                </button>
                                <span className="mx-0.5 h-4 w-px bg-border shrink-0" aria-hidden="true" />
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("media")} title="Add image" aria-label="Add image" aria-pressed={false}>
                                    <ImagePlus className="h-4 w-4" />
                                </button>
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("link")} title="Attach link" aria-label="Attach link" aria-pressed={activePanel === "link"}>
                                    <Link2 className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                                <span className={cn("font-mono text-[11px] font-medium tabular-nums", remaining < 0 ? "text-destructive font-semibold" : "text-muted-foreground")}>{remaining}</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={resetAfterPost}
                                    className="nb-touch-target h-[34px] rounded-[5px] border-border px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                    Discard
                                </Button>
                                <Button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        onPost({
                                            content,
                                            updateType: null,
                                            visibility: canManage ? visibility : "public",
                                            entityRefs: {
                                                ...entityRefs,
                                                references: normalizeProjectUpdateReferences(entityRefs.references),
                                            },
                                            media,
                                        });
                                        resetAfterPost();
                                    }}
                                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium"
                                >
                                    {isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    Post
                                </Button>
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );

        return (
            <div
                ref={containerRef}
                onDragOver={(event) => {
                    if (!expanded) return;
                    event.preventDefault();
                }}
                onDrop={(event) => {
                    if (!expanded) return;
                    event.preventDefault();
                    handleImageFiles(event.dataTransfer.files);
                }}
                className={cn(
                    "relative border-b border-border px-1 py-4 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[180ms] ease-out",
                    expanded ? "pb-5" : "pb-4",
                )}
            >
            {composerBody}
            {hiddenImageInput}


            <MultiAttachmentPicker
                projectId={projectId}
                projectName={projectName}
                isOpen={filePickerOpen}
                onClose={() => setFilePickerOpen(false)}
                initialAttachments={[]}
                onConfirm={(nodes) => {
                    nodes.forEach((node) => {
                        const normalizedLabel = normalizeReadmeReferenceLabel("files", node.name || "Project file");
                        const escapedLabel = normalizedLabel.replace(/\\/g, "\\\\").replace(/"/g, "&quot;").replace(/\s+/g, " ").trim();
                        const refText = `{% ref.files id="${node.id}" label="${escapedLabel}" %}`;
                        if (editorRef.current) {
                            editorRef.current.insertTextAtCursor(refText);
                        }
                        addContextReference("file", node.id);
                    });
                }}
            />
        </div>
    );
}
