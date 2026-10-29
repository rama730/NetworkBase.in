"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useUIStore } from "@/stores/ui-store";

const MyWorkDrawer = dynamic(() => import("../my-work/MyWorkDrawer"), { ssr: false });

export function MyWorkDrawerHost() {
    const isOpen = useUIStore((state) => state.isMyWorkOpen);
    const setMyWorkOpen = useUIStore((state) => state.setMyWorkOpen);
    const setMyWorkTab = useUIStore((state) => state.setMyWorkTab);
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const drawerType = searchParams?.get("drawerType");
    const drawerDeepLink = drawerType === "my-work" || drawerType === "workspace";
    // "workspace" is the old parameter name; links already sent keep working.
    const myWorkDeepLink = searchParams?.get("my-work") ?? searchParams?.get("workspace");
    const isDeepLinked = drawerDeepLink || Boolean(myWorkDeepLink);
    const requestedTab = myWorkDeepLink || searchParams?.get("workspaceTab");
    const [hasMounted, setHasMounted] = useState(isOpen || isDeepLinked);

    useEffect(() => {
        if (isOpen || isDeepLinked) setHasMounted(true);
    }, [isDeepLinked, isOpen]);

    useEffect(() => {
        if (!isDeepLinked) return;
        setMyWorkTab(requestedTab === "requests" ? "requests" : "tasks");
        setMyWorkOpen(true);
        // Legacy links need one ephemeral instruction to open the drawer; the
        // URL is immediately returned to the clean hub route.
        if (isDeepLinked) {
            const params = new URLSearchParams(searchParams?.toString());
            if (myWorkDeepLink) { params.delete("my-work"); params.delete("workspace"); }
            if (drawerDeepLink) {
                params.delete("drawerType");
                params.delete("workspaceTab");
            }
            const query = params.toString();
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }
    }, [drawerDeepLink, isDeepLinked, pathname, requestedTab, router, searchParams, setMyWorkOpen, setMyWorkTab, myWorkDeepLink]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
                const target = event.target as HTMLElement | null;
                const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
                if (!isInput) {
                    event.preventDefault();
                    setMyWorkOpen(!isOpen);
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, setMyWorkOpen]);

    // Below md the drawer is full screen, so a route change (including browser Back) must not leave it covering the new page.
    const previousPathnameRef = useRef(pathname);
    useEffect(() => {
        if (previousPathnameRef.current === pathname) return;
        previousPathnameRef.current = pathname;
        if (window.matchMedia("(max-width: 767px)").matches) setMyWorkOpen(false);
    }, [pathname, setMyWorkOpen]);

    // Keep the lazily loaded host after its first open so Radix can
    // play the closed-state animation instead of being unmounted immediately.
    return hasMounted ? <MyWorkDrawer /> : null;
}
