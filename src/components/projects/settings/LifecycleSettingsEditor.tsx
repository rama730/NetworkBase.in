'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Loader2,
    Info,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LifecycleEditor as BaseLifecycleEditor } from "@/components/projects/LifecycleEditor";
import { SettingsCard } from '@/components/projects/settings/SettingsFormFields';

export function LifecycleSettingsEditor({
    initialStages,
    currentStageIndex,
    isSaving,
    onSave,
}: {
    initialStages: string[];
    currentStageIndex: number;
    isSaving: boolean;
    onSave: (stages: string[], currentStageIdentity: string) => Promise<void>;
}) {
    const [stages, setStages] = useState(initialStages);
    const currentStageIdentity = initialStages[currentStageIndex] || "";
    useEffect(() => {
        setStages(initialStages);
    }, [initialStages]);

    const isDirty = useMemo(() => {
        if (stages.length !== initialStages.length) return true;
        return stages.some((stage, idx) => stage !== initialStages[idx]);
    }, [stages, initialStages]);

    const handleCancel = useCallback(() => {
        setStages(initialStages);
    }, [initialStages]);

    const handleSave = useCallback(async () => {
        const cleaned = stages.map((stage) => stage.trim().replace(/\s+/g, " ")).filter(Boolean);
        if (cleaned.length === 0) {
            toast.error("You must have at least one stage");
            return;
        }
        await onSave(cleaned, currentStageIdentity);
    }, [currentStageIdentity, onSave, stages]);

    const currentStageName = initialStages[currentStageIndex] || stages[currentStageIndex] || stages[0] || "";

    return (
        <SettingsCard
            title="Project lifecycle"
            description="Define the journey stages used by the project dashboard, roadmap, and milestone tracking."
            footer={
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
                            className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={!isDirty || isSaving || stages.length === 0}
                            className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                            Save changes
                        </Button>
                    </div>
                </>
            }
        >
            <div className="space-y-6">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-1">
                        <p className="nb-ui-label text-foreground">Lifecycle roadmap alignment</p>
                        <p className="nb-compact text-muted-foreground">
                            Stages define the progression milestones shown on your project overview and roadmap. As your team completes deliverables, project leads can advance through these stages directly from the project dashboard header.
                        </p>
                    </div>
                </div>

                <BaseLifecycleEditor
                    stages={stages}
                    onChange={setStages}
                    currentStageIndex={currentStageIndex}
                />
            </div>
        </SettingsCard>
    );
}
