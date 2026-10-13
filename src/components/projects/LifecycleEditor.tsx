"use client";

import React, { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

let stageIdSeq = 0;
const newId = () => `stage-${stageIdSeq++}`;

interface LifecycleEditorProps {
    stages: string[];
    /** `currentStageName` follows the current stage through renames and reorders; null once it is removed. */
    onChange: (stages: string[], currentStageName: string | null) => void;
    currentStageIndex?: number; // Optional visual indicator of current progress
    showCurrentStage?: boolean;
}

function SortableStage({ id, label, className, children }: { id: string; label: string; className: string; children: (handle: React.ReactNode) => React.ReactNode }) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
    const handle = (
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${label} stage`} className="inline-flex shrink-0 cursor-grab touch-none items-center text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
        </button>
    );
    return (
        <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(className, isDragging && "relative z-10")}>
            {children(handle)}
        </div>
    );
}

export function LifecycleEditor({ stages, onChange: emitChange, currentStageIndex = 0, showCurrentStage = true }: LifecycleEditorProps) {
    const [newStage, setNewStage] = useState("");
    const [errorMsg, setErrorMsg] = useState("");
    // Row identity is a parallel id list, never the stage text: renaming keeps focus and duplicates
    // keep distinct keys. The current stage is tracked by id, so its index survives edits.
    const [ids, setIds] = useState<string[]>(() => stages.map(newId));
    const [currentId, setCurrentId] = useState<string | null>(() => ids[currentStageIndex] ?? null);
    if (ids.length !== stages.length) {
        // The parent replaced the list (cancel/reset): start a fresh identity.
        const fresh = stages.map(newId);
        setIds(fresh);
        setCurrentId(fresh[currentStageIndex] ?? null);
    }
    const liveCurrentIndex = currentId ? ids.indexOf(currentId) : -1;
    const onChange = (nextStages: string[], nextIds: string[]) => {
        setIds(nextIds);
        const currentAt = currentId ? nextIds.indexOf(currentId) : -1;
        emitChange(nextStages, currentAt >= 0 ? nextStages[currentAt] ?? null : null);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        const cleaned = val.replace(/[^\p{L}\p{N}\s&]/gu, "");
        
        let msg = "";
        if (cleaned !== val) {
            msg = "Only letters, numbers, spaces, and & are allowed";
        } else {
            const trimmed = cleaned.trim().replace(/\s+/g, " ");
            if (trimmed && stages.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
                msg = "Stage name already exists";
            }
        }
        setErrorMsg(msg);
        setNewStage(cleaned);
    };

    const handleAdd = () => {
        const trimmed = newStage.trim().replace(/\s+/g, " ");
        if (!trimmed) return;

        if (trimmed.length < 2) {
            setErrorMsg("Stage name must be at least 2 characters");
            return;
        }

        if (stages.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
            setErrorMsg("Stage name already exists");
            return;
        }

        onChange([...stages, trimmed], [...ids, newId()]);
        setNewStage("");
        setErrorMsg("");
    };

    const handleRemove = (index: number) => {
        if (stages.length <= 1) return;
        onChange(stages.filter((_, i) => i !== index), ids.filter((_, i) => i !== index));
    };

    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        onChange(arrayMove(stages, from, to), arrayMove(ids, from, to));
    };

    const handleStageChange = (index: number, value: string) => {
        const cleaned = value.replace(/[^\p{L}\p{N}\s&]/gu, "");
        let msg = "";
        const trimmed = cleaned.trim().replace(/\s+/g, " ");
        if (cleaned !== value) {
            msg = "Only letters, numbers, spaces, and & are allowed";
        } else if (trimmed && stages.some((stage, i) => i !== index && stage.toLowerCase() === trimmed.toLowerCase())) {
            msg = "Stage name already exists";
        }
        setErrorMsg(msg);
        onChange(stages.map((stage, i) => (i === index ? cleaned : stage)), ids);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
        }
    };

    return (
        <div className="divide-y divide-border">
            <div className="pb-6">
                <div className="space-y-1.5">
                    <div>
                        <label htmlFor="lifecycle-add-stage-input" className="nb-ui-label text-foreground">
                            Add stage
                        </label>
                        <p className="nb-compact text-muted-foreground mt-0.5">
                            Define milestones your team will progress through (e.g. Prototype, Security Audit, Public Beta).
                        </p>
                    </div>
                    <div className="flex gap-2 pt-0.5">
                        <input
                            id="lifecycle-add-stage-input"
                            value={newStage}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            maxLength={35}
                            aria-describedby={errorMsg ? "lifecycle-stage-error" : undefined}
                            placeholder="Add a stage (e.g. 'Beta Testing', 'Design Review')..."
                            className="nb-touch-target h-[34px] flex-1 rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <Button
                            type="button"
                            onClick={handleAdd}
                            disabled={!newStage.trim() || !!errorMsg}
                            className="nb-touch-target h-[34px] gap-1.5 rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add stage
                        </Button>
                    </div>
                    {errorMsg && (
                        <p id="lifecycle-stage-error" role="alert" className="nb-compact text-destructive animate-in fade-in-50 duration-[180ms]">
                            {errorMsg}
                        </p>
                    )}
                </div>
            </div>

            <div className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h5 className="nb-ui-label font-semibold text-foreground">Project journey stages</h5>
                        <p className="nb-compact text-muted-foreground mt-0.5">
                            Drag stages using the grip handle to reorder the project roadmap timeline.
                        </p>
                    </div>
                    <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] border border-border bg-muted/40 font-mono text-[11px] leading-none text-muted-foreground">
                        {stages.length} {stages.length === 1 ? "stage" : "stages"}
                    </span>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                    {stages.map((stage, index) => (
                        <SortableStage
                            key={ids[index]}
                            id={ids[index]!}
                            label={stage}
                            className={cn(
                                "flex min-h-[44px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-none transition-colors",
                                showCurrentStage && index === liveCurrentIndex
                                    ? "border-primary/40 bg-primary/[0.03] ring-1 ring-primary/20"
                                    : "border-border hover:border-border/80"
                            )}
                        >
                            {(handle) => (<>
                            {handle}
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-[3px] border border-border/80 bg-muted/40 font-mono text-[11px] font-medium tabular-nums text-muted-foreground leading-none">
                                {index + 1}
                            </span>
                            <input
                                value={stage}
                                onChange={(event) => handleStageChange(index, event.target.value)}
                                maxLength={35}
                                className="nb-touch-target h-[28px] flex-1 rounded-[5px] border border-transparent bg-transparent px-2 text-[13px] font-medium leading-[1.5] text-foreground transition hover:border-border/60 focus:border-border focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                aria-label={`Stage ${index + 1} name`}
                            />

                            {showCurrentStage && index === liveCurrentIndex && (
                                <span className="inline-flex items-center h-5 px-[7px] rounded-[3px] border border-primary/20 bg-primary/10 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-primary leading-none shrink-0">
                                    Current
                                </span>
                            )}

                            <button
                                type="button"
                                aria-label={`Remove ${stage} stage`}
                                onClick={() => handleRemove(index)}
                                disabled={stages.length <= 1}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                                title={stages.length <= 1 ? "At least one stage is required" : "Remove stage"}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                            </>)}
                        </SortableStage>
                    ))}
                </div>
                </SortableContext>
                </DndContext>

                {stages.length === 0 && (
                    <div className="nb-empty-state nb-grid-ground rounded-lg border border-dashed border-border p-6 text-center nb-compact text-muted-foreground">
                        No stages defined. Add one above.
                    </div>
                )}
            </div>
        </div>
    );
}
