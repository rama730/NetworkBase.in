import { redirect } from "next/navigation";

import NotificationsPageClient from "@/components/notifications/NotificationsPageClient";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { getViewerAuthContext } from "@/lib/server/viewer-context";

export function generateMetadata() {
    return buildRouteMetadata({ title: "Notifications · NetworkBase", description: "Everything that reached you: what needs you, what’s new and what came before.", path: "/notifications" });
}

/** The notifications page (notifications mix): the tray's full history on Network's frame. It loads in the browser. */
export default async function NotificationsPage() {
    const { user } = await getViewerAuthContext();
    if (!user) redirect(`/login?next=${encodeURIComponent("/notifications")}`);
    return <NotificationsPageClient />;
}
