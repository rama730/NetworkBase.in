import { logger } from "@/lib/logger";

type ExtensionMetricPayload = {
  action: string;
  success: boolean;
  durationMs?: number;
  userId?: string | null;
  projectId?: string | null;
  nodeId?: string | null;
  sessionId?: string | null;
  uploadIntentId?: string | null;
  path?: string | null;
  method?: string | null;
  status?: number | null;
  errorCode?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
  count?: number | null;
  chunkCount?: number | null;
  revisionMode?: "new_revision" | "active_revision" | null;
  versionIncremented?: boolean | null;
};

export function recordExtensionMetric(metric: string, payload: ExtensionMetricPayload) {
  logger.metric(metric, {
    route: "extension",
    ...payload,
  });
}

