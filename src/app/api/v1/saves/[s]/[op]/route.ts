import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { jsonError } from "@/app/api/v1/_shared";
import { requireTokenScope } from "@/app/api/v1/_shared";
import { assertCanReadSave, filesAtSave, revertSave, saveDiff, zipEntriesAtSave } from "@/lib/domain/saves";
import { streamFolderExport } from "@/lib/files/folder-export";
import { safeContentDisposition } from "@/lib/storage/private-object-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ s: string; op: string }> };

/**
 * A save's diff of one file (`?path=`), its files at that moment (`files`, 5,000 a page by `cursor`, report H11) and
 * the whole tree as a zip (`zip`, report H3).
 */
export async function GET(request: Request, context: Ctx) {
  const { s, op } = await context.params;
  return changeSetRoute(request, { limit: "read", saveId: s }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    if (op === "diff") return saveDiff(auth, s, q.get("path") ?? "");
    if (op === "files") return filesAtSave(auth, s, { cursor: q.get("cursor"), path: q.get("path") });
    if (op === "zip") {
      const { save, entries } = await zipEntriesAtSave(auth, s);
      if (!entries.length) return jsonError("No files at this save", 404, "NOT_FOUND");
      const prepared = {
        operationId: crypto.randomUUID(),
        entries: entries.map((e, i) => ({ id: `${i}`, path: e.path.replace(/^\/+/, ""), type: "file" as const, bucket: "project-files", storageKey: e.storageKey, assetId: null, size: e.size })),
        totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
        requiresTaskAccess: false,
        skippedFiles: 0,
        historyName: `save-${save.seq}`,
        historyNodeId: null,
      };
      return new Response(streamFolderExport({ prepared, requestSignal: req.signal, reauthorize: () => assertCanReadSave(auth, s) }), {
        headers: { "Content-Type": "application/zip", "Content-Disposition": safeContentDisposition(`save-${save.seq}.zip`, "attachment"), "Cache-Control": "private, no-store" },
      });
    }
    return jsonError("Not found", 404, "NOT_FOUND");
  });
}

/** Revert (report H3): a new save that undoes this one, merging with later work; conflicts leave a change set open. */
export async function POST(request: Request, context: Ctx) {
  const { s, op } = await context.params;
  if (op !== "revert") return jsonError("Not found", 404, "NOT_FOUND");
  return changeSetRoute(request, { limit: "apply", saveId: s }, (auth, req) => revertSave(auth, req, s, { checkScope: (scope) => requireTokenScope(auth, scope) }));
}
