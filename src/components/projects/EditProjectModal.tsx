"use client";

import { useRoleApplicationCounts } from "@/hooks/useRoleApplicationCounts";
import React, { useState, useRef, useTransition } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { LifecycleEditor } from "@/components/projects/LifecycleEditor";
import { ProjectRolesEditor } from "@/components/projects/settings/ProjectRolesEditor";
import { normalizeProjectRoleFormValues } from "@/lib/projects/project-roles-form";
import { Layout, FileText, Layers, Users, X, Check, Info, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/feedback";
import { updateProject, updateProjectLifecycleAction } from "@/app/actions/project";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { ProjectLinkEditorFields, type ProjectLinkEditorHandle } from "@/components/projects/dashboard/ProjectSocialLinksCard";
import { socialLinkItemsFromStorage } from "@/lib/profile/normalization";
import { externalLinksSchema } from "@/lib/validations/project";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// --- Types & Schema ---

const roleSchema = z.object({
    id: z.string().optional(),
    role: z.string().min(1, "Role name is required"),
    count: z.number().min(1, "Count must be at least 1"),
    description: z.string().optional(),
    skills: z.array(z.string()).optional(),
});

const projectSchema = z.object({
    status: z.enum(["draft", "active", "completed", "archived"]),
    title: z.string().min(1, "Title is required").max(100),
    shortDescription: z.string().max(200, "Tagline must be less than 200 characters").optional(),
    description: z.string().optional(),
    problemStatement: z.string().optional(),
    solutionStatement: z.string().optional(),
    skills: z.array(z.string()),
    tags: z.array(z.string()),
    roles: z.array(roleSchema),
    lifecycleStages: z.array(z.string()),
    externalLinks: externalLinksSchema,
});

type ProjectFormValues = z.infer<typeof projectSchema>;

interface EditProjectModalProps {
    project: any; // Using any for flexibility with joined data
    isOpen: boolean;
    onClose: () => void;
    onSaved?: () => void;
}

// --- Icons & Config ---

const TABS = [
    { id: "essentials", label: "Workspace details", icon: Layout },
    { id: "details", label: "Description", icon: FileText },
    { id: "stack", label: "Links", icon: Layers },
    { id: "journey", label: "Stages", icon: CheckCircle },
    { id: "roles", label: "Roles and applications", icon: Users },
] as const;

// --- Components ---

function StatusSelector({ value, onChange }: { value: string; onChange: (val: string) => void }) {
    const options = [
        { id: "draft", label: "Draft", desc: "Only members can see it", color: "bg-blue-50 border-blue-200 text-blue-700" },
        { id: "active", label: "Active", desc: "People are working on it", color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
        { id: "completed", label: "Completed", desc: "The work is done", color: "bg-purple-50 border-purple-200 text-purple-700" },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {options.map((opt) => {
                const isSelected = value === opt.id;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChange(opt.id)}
                        className={cn(
                            "relative flex flex-col items-start p-3 rounded-lg border-2 transition-[color,background-color,border-color,box-shadow,opacity,transform] text-left",
                            isSelected
                                ? "border-indigo-600 bg-indigo-50/10 dark:bg-indigo-900/10"
                                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                        )}
                    >
                        {isSelected && (
                            <div className="absolute top-2 right-2 text-indigo-600">
                                <Check className="w-4 h-4" />
                            </div>
                        )}
                        <span className={cn(
                            "inline-block w-2.5 h-2.5 rounded-full mb-2",
                            opt.id === "draft" && "bg-blue-500",
                            opt.id === "active" && "bg-emerald-500",
                            opt.id === "completed" && "bg-purple-500"
                        )} />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{opt.label}</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{opt.desc}</span>
                    </button>
                );
            })}
        </div>
    );
}

// --- Main Component ---

export default function EditProjectModal({ project, isOpen, onClose, onSaved }: EditProjectModalProps) {
    // Organizations keep the same columns under their own words (report §34.11).
    const isOrg = (project as { kind?: string }).kind === "organization";
    const [activeTab, setActiveTab] = useState("essentials");
    const [isPending, startTransition] = useTransition();
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const projectLinksRef = useRef<ProjectLinkEditorHandle>(null);

    const initialStages: string[] = project.lifecycleStages ?? ["Concept", "Team formation", "MVP", "Beta", "Launch"];
    const currentStageIndex: number = project.currentStageIndex ?? 0;
    const [currentStageName, setCurrentStageName] = useState<string | null>(initialStages[currentStageIndex] ?? null);

    // Setup Form
    const { register, control, handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<ProjectFormValues>({
        resolver: zodResolver(projectSchema),
        defaultValues: {
            status: project.status || "draft",
            title: project.title || "",
            shortDescription: project.shortDescription || "",
            description: project.description || "",
            problemStatement: project.problemStatement || "",
            solutionStatement: project.solutionStatement || "",
            skills: project.skills || [],
            tags: project.tags || [],
            // Check camelCase (Drizzle default) then snake_case (Raw/Legacy)
            // Use defaults ONLY if both are null/undefined, effectively initializing new/legacy projects
            lifecycleStages: initialStages,
            roles: normalizeProjectRoleFormValues(project.openRoles),
            externalLinks: socialLinkItemsFromStorage(project.externalLinks ?? project.external_links),
        }
    });

    const { fields: roleFields, append: appendRole, remove: removeRole } = useFieldArray({
        control,
        name: "roles",
        keyName: "fieldKey",
    });

    const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);
    const roleApplicationCounts = useRoleApplicationCounts(project.id, isOpen);

    const technologies = watch("skills");
    
    // Tag Input State
    const [tagInput, setTagInput] = useState("");
    const tags = watch("tags");

    // Auto-grow Textarea
    const adjustHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
    };

    const handleKeyDown = (
        e: React.KeyboardEvent, 
        value: string, 
        setValueState: (v: string) => void,
        currentList: string[],
        fieldName: "skills" | "tags"
    ) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) {
                if (!currentList.includes(value.trim())) {
                    setValue(fieldName, [...currentList, value.trim()]);
                }
                setValueState("");
            }
        }
    };

    const onSubmit = (data: ProjectFormValues) => {
        startTransition(async () => {
            try {
                const preparedLinks = await projectLinksRef.current?.prepareForSave();
                if (preparedLinks && !preparedLinks.success) return;
                const { lifecycleStages, status, ...rest } = data;
                // Archive has its own guarded flow; the stage lives in the lifecycle action, which re-maps it by name.
                await updateProject(project.id, {
                    ...rest,
                    ...(status === "archived" ? {} : { status }),
                    externalLinks: preparedLinks?.links ?? data.externalLinks,
                    deletedRoleIds,
                });
                if (lifecycleStages.join("\n") !== initialStages.join("\n")) {
                    const lifecycle = await updateProjectLifecycleAction(project.id, lifecycleStages, currentStageName ?? "");
                    if (!lifecycle.success) throw new Error(lifecycle.error);
                }
                toast.success("Workspace updated");
                if (onSaved) onSaved();
                onClose();
            } catch (error) {
                console.error(error);
                toast.error("Couldn’t update workspace");
            }
        });
    };

    const handleDeleteRole = (index: number, roleId?: string) => {
        if (roleId) {
            setDeletedRoleIds(prev => [...prev, roleId]);
        }
        removeRole(index);
    };

    const handleAttemptClose = () => {
        if (isDirty) {
            setShowDiscardConfirm(true);
        } else {
            onClose();
        }
    };

    const handleInvalidCapture = (e: React.FormEvent<HTMLFormElement>) => {
        const target = e.target as HTMLElement;
        const name = target.getAttribute("name") || "";
        if (name.startsWith("roles")) {
            setActiveTab("roles");
        } else if (name === "skills" || name === "tags" || name.startsWith("externalLinks")) {
            setActiveTab("stack");
        } else if (name === "status" || name === "lifecycleStages") {
            setActiveTab("journey");
        } else if (name === "problemStatement" || name === "solutionStatement" || name === "description") {
            setActiveTab("details");
        } else {
            setActiveTab("essentials");
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => {
                if (!open) handleAttemptClose();
            }}>
                <DialogContent
                    showCloseButton={false}
                    className="w-full max-w-5xl h-[85vh] p-0 rounded-lg border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                        <div>
                            <DialogTitle className="text-xl font-semibold text-foreground">Edit workspace</DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground font-medium">Edit workspace details</DialogDescription>
                        </div>
                        <button 
                            type="button"
                            onClick={handleAttemptClose}
                            aria-label="Close edit workspace modal"
                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Mobile Tab Strip (visible on small screens) */}
                    <div className="app-scroll app-scroll-x app-scroll-hidden flex md:hidden gap-1 border-b border-border bg-muted/30 p-2 shrink-0" role="tablist" aria-label="Edit workspace sections">
                        {TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "nb-touch-target flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                                        isActive
                                            ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Body */}
                    <div className="flex flex-1 min-h-0">
                        {/* Sidebar (md+) */}
                        <div className="w-64 border-r border-border bg-muted/20 hidden md:flex flex-col p-4 gap-1 overflow-y-auto shrink-0" role="tablist" aria-label="Edit workspace sections">
                            {TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeTab === tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] text-left",
                                        activeTab === tab.id
                                            ? "bg-card text-primary shadow-xs ring-1 ring-border font-semibold"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Content Form */}
                        <form 
                            id="edit-project-form" 
                            onSubmit={handleSubmit(onSubmit)}
                            onInvalidCapture={handleInvalidCapture}
                            className="flex-1 overflow-y-auto p-6 md:p-8 pb-24"
                        >
                                <div className="max-w-3xl mx-auto space-y-8">
                                    {/* ESSENTIALS */}
                                    {activeTab === "essentials" && (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-[260ms]">
                                            <div className="space-y-6 bg-zinc-50/50 dark:bg-zinc-800/30 p-6 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                                <Controller
                                                    control={control}
                                                    name="status"
                                                    render={({ field }) => (
                                                        <div>
                                                            <label className="block text-sm font-medium mb-3 text-zinc-900 dark:text-zinc-100">Removed</label>
                                                            <StatusSelector value={field.value} onChange={field.onChange} />
                                                        </div>
                                                    )}
                                                />
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label htmlFor="edit-project-title" className="block text-sm font-medium mb-1.5 text-foreground">Workspace title</label>
                                                    <input
                                                        id="edit-project-title"
                                                        {...register("title")}
                                                        className="w-full px-4 py-3 rounded-lg border border-border bg-transparent outline-none transition-[color,background-color,border-color,box-shadow,opacity,transform] text-foreground"
                                                        placeholder="e.g. NextGen CRM"
                                                    />
                                                    {errors.title && <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>}
                                                </div>
                                                <div>
                                                    <label htmlFor="edit-project-tagline" className="block text-sm font-medium mb-1.5 text-foreground">Tagline</label>
                                                    <input
                                                        id="edit-project-tagline"
                                                        {...register("shortDescription")}
                                                        className="w-full px-4 py-3 rounded-lg border border-border bg-transparent outline-none transition-[color,background-color,border-color,box-shadow,opacity,transform] text-foreground"
                                                        placeholder="A brief pitch for your workspace…"
                                                    />
                                                    {errors.shortDescription && <p className="text-red-500 text-sm mt-1">{errors.shortDescription.message}</p>}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* DETAILS */}
                                    {activeTab === "details" && (
                                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-[260ms]">
                                            <div>
                                                <label htmlFor="edit-project-description" className="block text-sm font-medium mb-2 text-foreground">Full description</label>
                                                <textarea
                                                    id="edit-project-description"
                                                    {...register("description")}
                                                    onInput={(e: any) => adjustHeight(e)}
                                                    className="w-full px-4 py-3 min-h-[150px] rounded-lg border border-border bg-transparent outline-none transition-[color,background-color,border-color,box-shadow,opacity,transform] resize-none text-foreground"
                                                    placeholder="Tell the full story of your workspace…"
                                                />
                                            </div>
                                            <div className="grid gap-6">
                                                <div>
                                                    <label htmlFor="edit-project-problem" className="block text-sm font-medium mb-2 text-foreground">{isOrg ? "Who it’s for" : "Problem statement"}</label>
                                                    <textarea
                                                        id="edit-project-problem"
                                                        {...register("problemStatement")}
                                                        onInput={(e: any) => adjustHeight(e)}
                                                        className="w-full px-4 py-3 min-h-[100px] rounded-lg border border-border bg-transparent outline-none transition-[color,background-color,border-color,box-shadow,opacity,transform] resize-none text-foreground"
                                                        placeholder={isOrg ? "Who joins this organization?" : "What problem are you solving?"}
                                                    />
                                                </div>
                                                <div>
                                                    <label htmlFor="edit-project-solution" className="block text-sm font-medium mb-2 text-foreground">{isOrg ? "What members do here" : "Solution Overview"}</label>
                                                    <textarea
                                                        id="edit-project-solution"
                                                        {...register("solutionStatement")}
                                                        onInput={(e: any) => adjustHeight(e)}
                                                        className="w-full px-4 py-3 min-h-[100px] rounded-lg border border-border bg-transparent outline-none transition-[color,background-color,border-color,box-shadow,opacity,transform] resize-none text-foreground"
                                                        placeholder={isOrg ? "What do members do here?" : "How does your workspace solve it?"}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* STACK & LINKS */}
                                    {activeTab === "stack" && (
                                        <div className="min-w-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-[260ms]">
                                            {/* Tech Stack */}
                                            <div>
                                                <SkillPicker value={technologies} onChange={(next) => setValue("skills", next, { shouldDirty: true, shouldValidate: true })} label="Workspace skills and technologies" />
                                            </div>

                                            <div>
                                                <h3 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Workspace links</h3>
                                                <p className="mb-4 text-sm text-zinc-500">Links appear next to the workspace name.</p>
                                                <ProjectLinkEditorFields
                                                    ref={projectLinksRef}
                                                    links={watch("externalLinks")}
                                                    savedLinks={project.externalLinks ?? project.external_links}
                                                    onChange={(links) => setValue("externalLinks", links, { shouldDirty: true, shouldValidate: true })}
                                                    githubRepoUrl={project.githubRepoUrl ?? project.github_repo_url}
                                                    importSource={project.importSource ?? (project as any).import_source}
                                                    githubSyncConnection={project.githubSyncConnection ?? (project as any).github_sync_connection}
                                                    health={project.externalLinkMetadata ?? project.external_link_metadata}
                                                    projectType={project.category}
                                                />
                                            </div>

                                            {/* Tags */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Tags</label>
                                                <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 min-h-[80px] bg-zinc-50/30 dark:bg-zinc-800/20">
                                                    <div className="flex min-w-0 flex-wrap gap-2 mb-3">
                                                        {tags.map((tag) => (
                                                            <span key={tag} className="inline-flex min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm border border-blue-100 dark:border-blue-800">
                                                                <span className="truncate">#{tag}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setValue("tags", tags.filter(t => t !== tag))}
                                                                    className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <input
                                                        value={tagInput}
                                                        onChange={(e) => setTagInput(e.target.value)}
                                                        onKeyDown={(e) => handleKeyDown(e, tagInput, setTagInput, tags, "tags")}
                                                        placeholder="Type tag (e.g. opensource) and press Enter…"
                                                        className="w-full bg-transparent outline-none text-sm placeholder:text-zinc-400"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* JOURNEY */}
                                    {activeTab === "journey" && (
                                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-[260ms]">
                                            <div>
                                                <h3 className="nb-card-title text-foreground mb-1">Stages</h3>
                                                <p className="nb-compact text-muted-foreground mb-4">Customize the stages your workspace will progress through.</p>
                                                
                                                <div className="bg-card p-6 rounded-lg border border-border">
                                                    <LifecycleEditor 
                                                        stages={watch('lifecycleStages')}
                                                        onChange={(stages, current) => {
                                                            setValue('lifecycleStages', stages);
                                                            setCurrentStageName(current);
                                                        }}
                                                        currentStageIndex={currentStageIndex}
                                                    />
                                                </div>

                                                <div className="mt-4 p-4 rounded-lg bg-muted/20 border border-border flex gap-3 text-xs text-muted-foreground">
                                                    <Info className="w-4 h-4 shrink-0 text-muted-foreground mt-0.5" />
                                                    <div className="space-y-0.5">
                                                        <p className="nb-ui-label text-foreground">Roadmap synchronization</p>
                                                        <p className="nb-compact text-muted-foreground">
                                                            Use the dashboard Advance button to move between these stages. 
                                                            Reordering stages here will update the roadmap immediately.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ROLES */}
                                    {activeTab === "roles" && (
                                        <ProjectRolesEditor
                                            fields={roleFields}
                                            register={register}
                                            control={control}
                                            errors={errors}
                                            disabled={isPending}
                                            className="animate-in fade-in slide-in-from-bottom-2 duration-[260ms]"
                                            onAddRole={() => appendRole({ role: "New role", count: 1, description: "", skills: [] })}
                                            onRemoveRole={handleDeleteRole}
                                            applicationCounts={roleApplicationCounts}
                                        />
                                    )}
                                </div>
                            </form>
                        </div>

                        {/* Sticky Footer */}
                        <div className="p-4 border-t border-border bg-card backdrop-blur-none flex items-center gap-3 shrink-0 z-20">
                            <div className="mr-auto hidden sm:block">
                                <p className="text-xs text-muted-foreground">
                                    {isPending ? "Saving changes…" : "Unsaved changes will be lost if you cancel."}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleAttemptClose}
                                className="px-5 py-2.5 rounded-lg border border-border font-medium text-sm hover:bg-muted transition-colors text-foreground"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="edit-project-form"
                                disabled={isPending}
                                className="px-6 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isPending && <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />}
                                {isPending ? "Saving..." : "Save changes"}
                            </button>
                        </div>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={showDiscardConfirm}
                onOpenChange={setShowDiscardConfirm}
                title="Discard unsaved changes?"
                description="You have unsaved changes. Are you sure you want to discard them and close the editor?"
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                variant="destructive"
                onConfirm={() => {
                    setShowDiscardConfirm(false);
                    onClose();
                }}
            />
        </>
    );
}
