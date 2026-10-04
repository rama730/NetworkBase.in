import { readFile } from "node:fs/promises";
import path from "node:path";

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function main() {
  const [
    taskActions,
    chatAttachmentRoute,
    changePasswordRoute,
    gitSyncWorker,
    accountCleanupWorker,
    profileData,
    connectionsActions,
  ] = await Promise.all([
    readWorkspaceFile("src/app/actions/task.ts"),
    readWorkspaceFile("src/app/api/v1/chat/attachments/[assetId]/route.ts"),
    readWorkspaceFile("src/app/api/v1/auth/change-password/route.ts"),
    readWorkspaceFile("src/inngest/functions/git-sync.ts"),
    readWorkspaceFile("src/inngest/functions/account-cleanup.ts"),
    readWorkspaceFile("src/lib/data/profile.ts"),
    readWorkspaceFile("src/app/actions/connections.ts"),
  ]);

  const checks: Array<[string, boolean]> = [
    [
      "task mutations are scoped to the supplied project",
      taskActions.includes("const locked = await lockTaskForWrite(tx, taskId, user.id)") &&
        taskActions.includes("if (locked.projectId !== projectId)") &&
        taskActions.includes(".where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))"),
    ],
    [
      "chat attachments open only through the member-checked route (short-lived signed URL)",
      chatAttachmentRoute.includes("app_private.chat_is_member(ca.channel_id") && chatAttachmentRoute.includes("createSignedUrl(storageKey, seconds)") && chatAttachmentRoute.includes("signedUrlSeconds("),
    ],
    [
      "passwordless password changes require MFA step-up",
      changePasswordRoute.includes("Set up MFA and verify this device before setting a password on this account"),
    ],
    [
      "git workers verify signed job requests",
      gitSyncWorker.includes('verifySignedJobRequestToken(jobSignature') && gitSyncWorker.includes('kind: "git/pull"'),
    ],
    [
      "account cleanup worker verifies signed job requests",
      accountCleanupWorker.includes('verifySignedJobRequestToken(jobSignature'),
    ],
    [
      "profile reads use the shared viewer-scoped serializer",
      profileData.includes("buildViewerScopedProfileView("),
    ],
    [
      "privacy-sensitive profile surfaces emit read audit events",
      profileData.includes("recordPrivacyReadEvent(") &&
        connectionsActions.includes("recordPrivacyReadEvents("),
    ],
  ];

  // Every exported chat server action authenticates first (requireChatUser) and
  // performs its permission checks in the app_private SQL functions.
  const chatActionFiles = ["channels", "members", "messages", "read", "activity"];
  for (const name of chatActionFiles) {
    const source = await readWorkspaceFile(`src/app/actions/chat/${name}.ts`);
    const exportsList = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
    checks.push([
      `chat/${name}.ts: every action starts with requireChatUser()`,
      exportsList.length > 0 && exportsList.every(([, , body]) => /^\s*const user = await requireChatUser\(\);\s*\n\s*if \(!user\) return unauthorized;/.test(body ?? "")),
    ]);
  }

  const failed = checks.filter(([, passed]) => !passed);
  if (failed.length > 0) {
    throw new Error(`Authorization contract failed: ${failed.map(([label]) => label).join(", ")}`);
  }

  console.log("[authz-contract] ok");
}

main().catch((error) => {
  console.error("[authz-contract] failed:", error);
  process.exit(1);
});

export {};
