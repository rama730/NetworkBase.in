import { NetworkRouteSkeleton } from "@/components/network/NetworkRouteSkeleton";

/** The notifications page has Network's layout, so it waits in Network's skeleton. */
export default function NotificationsLoading() {
    return <NetworkRouteSkeleton />;
}
