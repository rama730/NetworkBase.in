// Old address of a renamed route (report decision 5): the published VS Code extension and links already sent use it.
// It serves the same handlers until the extension moves to the new path; then this file is deleted.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { GET } from "@/app/api/v1/workspaces/[id]/sync-diff/route";
