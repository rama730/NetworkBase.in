import { WORKSPACE_STATUS_LABELS } from "@/lib/copy/terms";

/** Decision 11: status words only (Draft, Active, Completed, Archived); progress is the workspace's Stages. */
export const WORKSPACE_STAGE_LABELS = WORKSPACE_STATUS_LABELS;

export function projectStageLabel(status: string | null | undefined): string {
    if (!status) return "Draft";
    return WORKSPACE_STAGE_LABELS[status as keyof typeof WORKSPACE_STAGE_LABELS] ?? status;
}
