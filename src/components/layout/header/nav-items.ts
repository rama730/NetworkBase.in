import { Compass, MessageSquare, Settings, Users } from "@/components/ui/icons";

import { ROUTES } from "@/constants/routes";

export const MAIN_NAV_ITEMS = [
    { href: ROUTES.DISCOVER, label: "Discover", icon: Compass },
    { href: ROUTES.NETWORK, label: "Network", icon: Users },
    { href: ROUTES.MESSAGES, label: "Messages", icon: MessageSquare },
] as const;

export const SETTINGS_NAV_ITEM = {
    href: ROUTES.SETTINGS,
    label: "Settings",
    icon: Settings,
} as const;

export function isMainNavRouteActive(pathname: string | null, href: string) {
    return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}
