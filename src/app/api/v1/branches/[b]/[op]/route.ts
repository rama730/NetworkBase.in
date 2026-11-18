import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { jsonError } from "@/app/api/v1/_shared";
import { branchChanges, branchFile, branchFileAtSave, branchFileDiff, branchTree, listBranchFiles, loadBranch, restoreBranch, useSaveOnBranch, updateFromMain } from "@/lib/domain/branches";
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
      // `save=n`: the file as that save of the branch left it (nb diff --from on a branch, C14b).
      const { file } = q.get("save") ? await branchFileAtSave(auth, b, q.get("path") ?? "", Number(q.get("save"))) : await branchFile(auth, b, q.get("path") ?? "");
      if (!file.storageKey) return jsonError("File content unavailable", 404, "NOT_FOUND");
      const { data, error } = await (await createAdminClient()).storage.from("project-files").createSignedUrl(file.storageKey, 60);
      if (error || !data?.signedUrl) return jsonError("File content unavailable", 404, "NOT_FOUND");
      // Previews (H-2b): images and PDFs show in the page; everything else downloads (never HTML or SVG inline).
      const mime = (file.mimeType ?? "").toLowerCase();
      const inline = q.get("inline") === "1" && (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(mime) || mime === "application/pdf");
      return streamPrivateObject({ request: req, signedUrl: data.signedUrl, totalSize: file.size ?? 0, mimeType: inline ? mime : file.mimeType ?? "application/octet-stream", filename: file.path.split("/").pop()!, disposition: inline ? "inline" : "attachment", etag: `"${file.contentHash ?? "none"}"` });
    }
    if (op === "zip") {
      const { branch, main } = await loadBranch(auth, b);
      const entries: Array<{ path: string; storageKey: string; size: number }> = [];
      let cursor: string | null = null;
      do {
        // A folder of the branch (`path`), or all of it.
        const page = await branchTree(branch, main.id, { cursor, path: q.get("path") ? `/${q.get("path")!.split("/").filter(Boolean).join("/")}` : null });
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
      const folder = q.get("path")?.split("/").filter(Boolean).pop();
      const name = `${branch.name.replace(/[^A-Za-z0-9._-]+/g, "-")}${folder ? `-${folder.replace(/[^A-Za-z0-9._-]+/g, "-")}` : ""}.zip`;
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
  if (op !== "restore" && op !== "update" && op !== "use") return jsonError("Not found", 404, "NOT_FOUND");
  return changeSetRoute(request, { limit: "apply", branchId: b }, async (auth, req) => {
    if (op === "restore") return restoreBranch(auth, b, req);
    const body = await readJson(req);
    // nb file use on a branch (C14b): `{ path, save }`, the file as that save of the branch left it.
    if (op === "use") return useSaveOnBranch(auth, b, { path: String(body.path ?? ""), save: Number(body.save) });
    const resolutions = body.resolutions && typeof body.resolutions === "object" ? Object.fromEntries(Object.entries(body.resolutions).filter(([, v]) => v === "branch" || v === "main")) as Record<string, "branch" | "main"> : {};
    return updateFromMain(auth, b, { resolutions });
  });
}
