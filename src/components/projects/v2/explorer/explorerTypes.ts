
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

export function formatBytes(bytes?: number | null) {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

