import { inngest } from "../client";
import { backupPendingStorageAssets } from "@/lib/storage/asset-backup";

export const storageAssetBackup = inngest.createFunction(
  { id: "storage-asset-backup", concurrency: 1 },
  { cron: "25 * * * *" },
  async ({ step }) => step.run("backup-pending-assets", backupPendingStorageAssets),
);
