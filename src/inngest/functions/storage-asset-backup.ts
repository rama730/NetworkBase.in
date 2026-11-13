import { inngest } from "../client";
import { backupPendingStorageAssets } from "@/lib/storage/asset-backup";

export const storageAssetBackup = inngest.createFunction(
  { id: "storage-asset-backup", concurrency: 1 },
  // ponytail: 2-hour backup sweep without a single-step wrapper to halve Inngest HTTP round trips. ceiling: backup copies lag up to 2h. upgrade: hourly when upload volume exceeds 500 assets/day.
  { cron: "25 */2 * * *" },
  async () => backupPendingStorageAssets(),
);
