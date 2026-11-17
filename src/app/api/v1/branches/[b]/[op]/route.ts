import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { jsonError } from "@/app/api/v1/_shared";
import { branchChanges, branchFile, branchFileDiff, branchTree, listBranchFiles, loadBranch, restoreBranch, updateFromMain } from "@/lib/domain/branches";
import { streamFolderExport } from "@/lib/files/folder-export";
import { createAdminClient } from "@/lib/supabase/server";
import { safeContentDisposition, streamPrivateObject } from "@/lib/storage/private-object-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ b: string; op: string }> };

/**
 * A branch's files (the resolver, report H11, 5,000 a page), its changes against main and one file's diff (`path`),
 * one file's bytes (`raw`, for nb pull on a branch) and the whole branch as a zip (H14).
 */
export async function GET(request: Request, context: Ctx) {
  const { b, op } = await context.params;
  return changeSetRoute(request, { limit: "read", branchId: b }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    if (op === "files") return listBranchFiles(auth, b, { cursor: q.get("cursor"), path: q.get("path") });
    if (op === "changes") return branchChanges(auth, b);
    if (op === "diff") return branchFileDiff(auth, b, q.get("path") ?? "");
    if (op === "raw") {
      const { file } = await branchFile(auth, b, q.get("path") ?? "");
      if (!file.storageKey) return jsonError("File content unavailable", 404, "NOT_FOUND");
      const { data, error } = await (await createAdminClient()).storage.from("project-files").createSignedUrl(file.storageKey, 60);
      if (error || !data?.signedUrl) return jsonError("File content unavailable", 404, "NOT_FOUND");
      return streamPrivateObject({ request: req, signedUrl: data.signedUrl, totalSize: file.size ?? 0, mimeType: file.mimeType ?? "application/octet-stream", filename: file.path.split("/").pop()!, disposition: "attachment", etag: `"${file.contentHash ?? `r${file.revision}`}"` });
    }
    if (op === "zip") {
      const { branch, main } = await loadBranch(auth, b);
      const entries: Array<{ path: string; storageKey: string; size: number }> = [];
      let cursor: string | null = null;
      do {
        const page = await branchTree(branch, main.id, { cursor });
        for (const f of page.files) if (f.storageKey) entries.push({ path: f.path, storageKey: f.storageKey, size: f.size ?? 0 });
        if (entries.length > 20_000) return jsonError("A zip holds at most 20,000 files", 413, "TOO_LARGE" as never);
        cursor = page.nextCursor;
      } while (cursor);
      if (!entries.length) return jsonError("No files on this branch", 404, "NOT_FOUND");
      const prepared = {
        operationId: crypto.randomUUID(),
        entries: entries.map((e, i) => ({ id: `${i}`, path: e.path.replace(/^\/+/, ""), type: "file" as const, bucket: "project-files", storageKey: e.storageKey, assetId: null, size: e.size })),
        totalBytes: entries.reduce((sum, e) => sum + e.size, 0), requiresTaskAccess: false, skippedFiles: 0, historyName: branch.name, historyNodeId: null,
      };
      const name = `${branch.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.zip`;
      return new Response(streamFolderExport({ prepared, requestSignal: req.signal, reauthorize: async () => { await loadBranch(auth, b); } }), {
        headers: { "Content-Type": "application/zip", "Content-Disposition": safeContentDisposition(name, "attachment"), "Cache-Control": "private, no-store" },
      });
    }
    return jsonError("Not found", 404, "NOT_FOUND");
  });
}

/** Restore a deleted branch (30 days); update from main: `{ resolutions?: { [path]: "branch" | "main" } }` (H13). */
export async function POST(request: Request, context: Ctx) {
  const { b, op } = await context.params;
  if (op !== "restore" && op !== "update") return jsonError("Not found", 404, "NOT_FOUND");
  return changeSetRoute(request, { limit: "apply", branchId: b }, async (auth, req) => {
    if (op === "restore") return restoreBranch(auth, b);
    const body = await readJson(req);
    const resolutions = body.resolutions && typeof body.resolutions === "object" ? Object.fromEntries(Object.entries(body.resolutions).filter(([, v]) => v === "branch" || v === "main")) as Record<string, "branch" | "main"> : {};
    return updateFromMain(auth, b, { resolutions });
  });
}
