// Old address of a renamed route (report decision 5): every /workspaces route answers at /projects too.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { GET } from "@/app/api/v1/workspaces/[id]/fs/[op]/route";
