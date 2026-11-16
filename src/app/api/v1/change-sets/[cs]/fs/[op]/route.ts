import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { jsonError } from "@/app/api/v1/_shared";
import { deleteFile, editFile, moveFile, writeFile } from "@/lib/domain/change-set-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string; op: string }> };

/** Routes 17–18 (report G14): edit, write, delete and move files in a change set's draft. */
export async function POST(request: Request, context: Ctx) {
  const { cs, op } = await context.params;
  return changeSetRoute(request, { limit: "items", changeSetId: cs }, async (auth, req) => {
    const b = (await readJson(req)) as Record<string, any>;
    if (op === "write") return writeFile(auth, cs, { path: String(b.path ?? ""), text: b.text ?? null, base64: b.base64 ?? null });
    if (op === "edit") {
      const edits = Array.isArray(b.edits) ? b.edits : [{ oldText: b.oldText, newText: b.newText, all: b.all }];
      return editFile(auth, cs, { path: String(b.path ?? ""), edits: edits.map((e: any) => ({ oldText: String(e?.oldText ?? ""), newText: String(e?.newText ?? ""), all: e?.all === true })) });
    }
    if (op === "delete") return deleteFile(auth, cs, String(b.path ?? ""));
    if (op === "move") return moveFile(auth, cs, { from: String(b.from ?? ""), to: String(b.to ?? "") });
    return jsonError("Not found", 404, "NOT_FOUND");
  });
}
