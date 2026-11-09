// One way to put files in a workspace (report §19.3): a folder, a new version of a file, or a task
// with a role. CLI 2.0, agents and browser drops use this address; the 1.x CLI keeps calling
// /api/v1/extension/fast-push. Both run the same handler.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { POST } from "@/app/api/v1/extension/fast-push/route";
