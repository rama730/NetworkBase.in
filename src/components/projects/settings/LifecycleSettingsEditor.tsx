'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Loader2,
    Info,
} from "lucide-react";
import { toast } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { LifecycleEditor as BaseLifecycleEditor } from "@/components/projects/LifecycleEditor";
import { SettingsCard } from '@/components/projects/settings/SettingsFormFields';

export function LifecycleSettingsEditor({
    initialStages,
    currentStageIndex,
    isSaving,
    isOwner = true,
    onSave,
}: {
    initialStages: string[];
    currentStageIndex: number;
    isSaving: boolean;
    isOwner?: boolean;
    onSave: (stages: string[], currentStageIdentity: string) => Promise<void>;
}) {
    const [stages, setStages] = useState(initialStages);
    // Follows the current stage through renames and reorders, so the save re-maps it by its new name.
    const [currentStageIdentity, setCurrentStageIdentity] = useState(initialStages[currentStageIndex] || "");
    // Bumped on every reset so the editor drops the row ids it built for the discarded edits.
    const [editorKey, setEditorKey] = useState(0);
    // Keyed on the values: a parent re-render with an equal (new) array must not wipe edits.
    const initialStagesKey = initialStages.join("\n");
    useEffect(() => {
        const next = initialStagesKey ? initialStagesKey.split("\n") : [];
        setStages(next);
        setCurrentStageIdentity(next[currentStageIndex] || "");
        setEditorKey((key) => key + 1);
    }, [initialStagesKey, currentStageIndex]);

    const isDirty = useMemo(() => {
        if (!isOwner) return false;
        if (stages.length !== initialStages.length) return true;
        return stages.some((stage, idx) => stage !== initialStages[idx]);
    }, [stages, initialStages, isOwner]);

    const handleCancel = useCallback(() => {
        setStages(initialStages);
        setCurrentStageIdentity(initialStages[currentStageIndex] || "");
        setEditorKey((key) => key + 1);
    }, [initialStages, currentStageIndex]);

    const handleSave = useCallback(async () => {
        if (!isOwner) return;
        const cleaned = stages.map((stage) => stage.trim().replace(/\s+/g, " ")).filter(Boolean);
        if (cleaned.length === 0) {
            toast.error("You must have at least one stage");
            return;
        }
        await onSave(cleaned, currentStageIdentity);
    }, [currentStageIdentity, isOwner, onSave, stages]);

    const currentStageName = initialStages[currentStageIndex] || stages[currentStageIndex] || stages[0] || "";

    return (
        <SettingsCard
            title="Project lifecycle"
            description="Define the journey stages used by the project dashboard, roadmap, and milestone tracking."
            footer={
                !isOwner ? (
                    <p className="nb-compact text-xs text-muted-foreground italic">
                        Only the owner can change this.
                    </p>
                ) : (
                    <>
                        <p className="nb-compact text-muted-foreground">
                            {isDirty ? (
                                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                    <span className="size-1.5 rounded-full bg-amber-500" />
                                    You have unsaved changes in lifecycle stages.
                                </span>
                            ) : (
                                <span>
                                    {stages.length} lifecycle stage{stages.length === 1 ? "" : "s"} configured
                                    {currentStageName ? (
                                        <>
                                            {" "}· Current stage: <strong className="font-semibold text-foreground">{currentStageName}</strong>
                                        </>
                                    ) : null}
                                </span>
                            )}
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleCancel}
                                disabled={!isDirty || isSaving}
                                className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={!isDirty || isSaving || stages.length === 0}
                                className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                            >
                                {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                Save changes
                            </Button>
                        </div>
                    </>
                )
            }
        >
            <div className="space-y-6">
                <div className="flex items-start gap-3 border-b border-border pb-4">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-1">
                        <p className="nb-ui-label text-foreground">Lifecycle roadmap alignment</p>
                        <p className="nb-compact text-muted-foreground">
                            Stages define the progression milestones shown on your project overview and roadmap. As your team completes deliverables, project leads can advance through these stages directly from the project dashboard header.
                        </p>
                    </div>
                </div>

                <BaseLifecycleEditor
                    key={editorKey}
                    stages={stages}
                    disabled={!isOwner || isSaving}
                    onChange={(next, current) => {
                        if (!isOwner) return;
                        setStages(next);
                        setCurrentStageIdentity(current ?? "");
                    }}
                    currentStageIndex={currentStageIndex}
                />
            </div>
        </SettingsCard>
    );
}
