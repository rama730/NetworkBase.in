import { readShellSummaryAction, type ShellSummary } from "@/app/actions/shell";
import { createPartBatcher } from "@/lib/part-batcher";

export const readShellPart = createPartBatcher<ShellSummary>(readShellSummaryAction);
