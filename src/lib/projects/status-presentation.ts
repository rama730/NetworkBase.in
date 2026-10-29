/** Display labels only: persisted project lifecycle values remain unchanged. */
export const PROJECT_STAGE_LABELS = {
    draft: "Forming",
    active: "Building",
    completed: "Shipped",
    archived: "Archived",
} as const;

export function projectStageLabel(status: string | null | undefined): string {
    if (!status) return "Workspace";
    return PROJECT_STAGE_LABELS[status as keyof typeof PROJECT_STAGE_LABELS] ?? status;
}
