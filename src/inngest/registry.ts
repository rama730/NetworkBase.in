import { createRequire } from "node:module";

export type InngestExecutionRole = "web" | "worker";

function getWorkerOnlyFunctions() {
  const loadModule = createRequire(import.meta.url);
  const { flushProjectViews } = loadModule("./functions/flush-views");
  const { flushUpdateLikes } = loadModule("./functions/flush-likes");
  const { cleanupProjectUpdate } = loadModule("./functions/cleanup-update");
  const { gitPull, gitPush, gitSyncRecovery, lockCleanup, uploadIntentCleanup } = loadModule("./functions/git-sync");
  const { finishPendingFileDeletions } = loadModule("./functions/project-files-permanent-delete");
  const { reconcileProjectFiles } = loadModule("./functions/project-files-reconciliation");
  const { projectImport } = loadModule("./functions/project-import");
  const { projectImportHydrate } = loadModule("./functions/project-import-hydrate");
  const { projectImportStaleReconcile } = loadModule("./functions/project-import-reconcile");
  const { reconcileWorkspaceProfileCounters } = loadModule("./functions/workspace-counter-reconcile");
  const { workspaceCountersRefresh } = loadModule("./functions/workspace-counter-refresh");
  const { accountCleanup } = loadModule("./functions/account-cleanup");
  const { accountHardDelete } = loadModule("./functions/account-hard-delete");
  const { computeSocialGraphSuggestions, refreshSocialGraphSuggestionsForCandidate } = loadModule("./functions/social-graph-suggestions");
  const { notificationsRetention } = loadModule("./functions/notifications-retention");
  const { notificationsRetentionWatchdog } = loadModule("./functions/notifications-retention-watchdog");
  const { notificationFanout } = loadModule("./functions/notification-fanout");
  const { notificationPushDelivery } = loadModule("./functions/notification-push-delivery");
  const { emailDelivery } = loadModule("./functions/email-delivery");
  const { extensionRecoveryRetention } = loadModule("./functions/extension-recovery-retention");
  const { chatMentionsRetention, chatIntegrityAudit, chatDue } = loadModule("./functions/chat-maintenance");
  const { reconcileSprintSchedule } = loadModule("./functions/sprint-schedule");
  const { cleanupSupersededProfileImage } = loadModule("./functions/profile-image-cleanup");
  const { dataLifecycleRetention } = loadModule("./functions/data-lifecycle-retention");
  const { storageAssetDeletion } = loadModule("./functions/storage-asset-deletion");
  const { storageAssetBackup } = loadModule("./functions/storage-asset-backup");

  return [
    projectImport,
    projectImportHydrate,
    gitPush,
    gitPull,
    gitSyncRecovery,
    lockCleanup,
    uploadIntentCleanup,
    flushProjectViews,
    flushUpdateLikes,
    cleanupProjectUpdate,
    reconcileProjectFiles,
    finishPendingFileDeletions,
    projectImportStaleReconcile,
    reconcileWorkspaceProfileCounters,
    workspaceCountersRefresh,
    accountCleanup,
    accountHardDelete,
    computeSocialGraphSuggestions,
    refreshSocialGraphSuggestionsForCandidate,
    notificationsRetention,
    notificationsRetentionWatchdog,
    notificationFanout,
    notificationPushDelivery,
    emailDelivery,
    extensionRecoveryRetention,
    chatMentionsRetention,
    chatDue,
    chatIntegrityAudit,
    reconcileSprintSchedule,
    cleanupSupersededProfileImage,
    dataLifecycleRetention,
    storageAssetDeletion,
    storageAssetBackup,
  ] as const;
}

// ponytail: a separate worker isolates GitHub imports from web memory. ceiling: two services to run. upgrade: merge them if imports move to streaming.
export function getInngestExecutionRole(): InngestExecutionRole {
  const configured = process.env.INNGEST_EXECUTION_ROLE?.trim().toLowerCase();
  if (configured === "web" || configured === "worker") {
    return configured;
  }

  if (configured) {
    throw new Error('INNGEST_EXECUTION_ROLE must be either "web" or "worker".');
  }

  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error('INNGEST_EXECUTION_ROLE must be explicitly set in production.');
  }

  return "worker";
}

export function getRegisteredInngestFunctions(
  role: InngestExecutionRole = getInngestExecutionRole(),
) {
  return role === "worker" ? [...getWorkerOnlyFunctions()] : [];
}
