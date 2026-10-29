import type { WorkspaceNode } from "@/lib/db/schema";
import type { UniversalPreviewType } from "../utils/fileKind";

export interface PreviewDriverProps<T = Record<string, unknown>> {
  node: WorkspaceNode;
  signedUrl: string | null;
  projectId?: string;
  onRetry?: () => void;
  onError?: (error: Error) => void;
  extra?: T;
}

export type PreviewDriverComponent<T = Record<string, unknown>> = React.ComponentType<PreviewDriverProps<T>>;

export interface DocumentHeading {
  id: string;
  level: number;
  text: string;
  element: HTMLElement;
}
