
export type ExplorerOperation = {
  id: string;
  label: string;
  status: "success" | "error" | "running";
  at: number;
  undo?: { label: string; run: () => Promise<void> };
};

export const EMPTY_OBJECT: Record<string, never> = {};
export const EMPTY_ARRAY: string[] = [];

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export { formatBytes } from "@/components/projects/v2/files-tab/folder/format";

