import { redirect } from "next/navigation";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";


export function generateMetadata() {
    return buildRouteMetadata({
        title: "My work · NetworkBase",
        description: "Your tasks, invitations and requests.",
        path: "/my-work",
    });
}

export default function MyWorkPage() {
    // My work is a drawer, not a page: this address only opens it over Discover.
    redirect("/discover?my-work=tasks");
}
