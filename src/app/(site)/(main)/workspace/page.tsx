import { redirect } from "next/navigation";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";


export function generateMetadata() {
    return buildRouteMetadata({
        title: "Workspace | NetworkBase",
        description: "A stable workspace shell for tasks, notes, inbox, and activity.",
        path: "/workspace",
    });
}

export default function WorkspacePage() {
    // /workspace was a second page only to open the hub drawer.
    // Keep old links working while discover remains the single workspace host.
    redirect("/discover?workspace=tasks");
}
