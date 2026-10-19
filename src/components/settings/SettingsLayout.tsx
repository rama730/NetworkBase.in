"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Bell, Lock, Palette, Plug, Scale, Shield, User, type LucideIcon } from "lucide-react";
import { settingsTabHref } from "@/constants/routes";
import { SETTINGS_SECTION_META } from "@/constants/settings";

type SettingsItem = { title: string; tab: string; href: string; icon: LucideIcon; description: string };
const settingsItems: SettingsItem[] = [
  { ...SETTINGS_SECTION_META.account, tab: "account", href: settingsTabHref("account"), icon: User },
  { ...SETTINGS_SECTION_META.security, tab: "security", href: settingsTabHref("security"), icon: Shield },
  { ...SETTINGS_SECTION_META.privacy, tab: "privacy", href: settingsTabHref("privacy"), icon: Lock },
  { ...SETTINGS_SECTION_META.notifications, tab: "notifications", href: settingsTabHref("notifications"), icon: Bell },
  { ...SETTINGS_SECTION_META.appearance, tab: "appearance", href: settingsTabHref("appearance"), icon: Palette },
  { ...SETTINGS_SECTION_META.integrations, tab: "integrations", href: settingsTabHref("integrations"), icon: Plug },
  { ...SETTINGS_SECTION_META["privacy-policies"], tab: "privacy-policies", href: settingsTabHref("privacy-policies"), icon: Scale },
];

function SettingsNav({
  activeTab,
  onNavigate,
}: {
  activeTab: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, item: SettingsItem) => void;
}) {
  return <nav aria-label="Settings sections" className="grid grid-cols-2 gap-1 pr-1 md:flex md:flex-col">{settingsItems.map((item) => {
    const Icon = item.icon;
    const active = activeTab === item.tab;
    return <Link key={item.tab} href={item.href} aria-current={active ? "page" : undefined} onClick={(event) => onNavigate(event, item)} title={item.title} className="nb-nav-link min-w-0 focus-visible:brightness-95">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 whitespace-normal break-words md:truncate md:whitespace-nowrap">{item.title}</span>
    </Link>;
  })}</nav>;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedTab = settingsItems.find((item) => item.tab === searchParams.get("tab"))?.tab ?? "account";
  const [activeTab, setActiveTab] = useState(requestedTab);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const locallyNavigatedTabRef = useRef<{ tab: string } | null>(null);
  const hasMountedRef = useRef(false);
  const active = settingsItems.find((item) => item.tab === activeTab) ?? settingsItems[0]!;

  const cancelScrollAlignment = useCallback(() => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
  }, []);

  const scrollToSection = useCallback((tab: string, behavior: ScrollBehavior = "smooth", useHash = false) => {
    cancelScrollAlignment();
    const hashTarget = useHash && window.location.hash
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    const root = scrollRootRef.current;
    const target = hashTarget && root?.contains(hashTarget) ? hashTarget : document.getElementById(`settings-${tab}`);
    if (!target) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : behavior;
    target.scrollIntoView({ behavior: motion, block: "start" });
  }, [cancelScrollAlignment]);

  useEffect(() => cancelScrollAlignment, [cancelScrollAlignment]);

  useEffect(() => {
    const isLocalNavigation = locallyNavigatedTabRef.current?.tab === requestedTab;
    if (isLocalNavigation) {
      locallyNavigatedTabRef.current = null;
      hasMountedRef.current = true;
      return;
    }

    const isInitialMount = !hasMountedRef.current;
    const behavior: ScrollBehavior = isInitialMount ? "auto" : "smooth";
    hasMountedRef.current = true;
    if (isInitialMount) setActiveTab(requestedTab);
    scrollFrameRef.current = window.requestAnimationFrame(() => scrollToSection(requestedTab, behavior, true));
    return cancelScrollAlignment;
  }, [requestedTab, scrollToSection, cancelScrollAlignment]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const updateActiveSection = () => {
      const rootTop = root.getBoundingClientRect().top;
      let closest: string | null = null;
      let distance = Number.POSITIVE_INFINITY;
      for (const item of settingsItems) {
        const section = document.getElementById(`settings-${item.tab}`);
        if (!section) continue;
        const rect = section.getBoundingClientRect();
        if (rect.bottom <= rootTop + 64) continue;
        const nextDistance = Math.abs(rect.top - rootTop - 24);
        if (nextDistance < distance) {
          closest = item.tab;
          distance = nextDistance;
        }
      }
      if (closest) setActiveTab(closest);
    };
    updateActiveSection();
    root.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => root.removeEventListener("scroll", updateActiveSection);
  }, [requestedTab]);

  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>, item: SettingsItem) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const localNavigation = { tab: item.tab };
    locallyNavigatedTabRef.current = localNavigation;
    router.replace(item.href, { scroll: false });
    scrollToSection(item.tab);
    window.setTimeout(() => {
      if (locallyNavigatedTabRef.current === localNavigation) locallyNavigatedTabRef.current = null;
    }, 1000);
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-card md:flex-row" aria-labelledby="settings-navigation-title">
      <aside aria-label="Settings navigation" className="w-full min-h-0 shrink-0 overflow-y-auto border-b border-border bg-card px-3 py-4 max-md:max-h-[45%] md:w-[var(--nb-sidebar-width)] md:border-b-0 md:border-r">
        <div className="mb-3 space-y-3 px-2 pr-3">
          <h1 id="settings-navigation-title" className="nb-micro">Settings</h1>
          <div className="h-px w-full bg-border" aria-hidden="true" />
        </div>
        <SettingsNav activeTab={active.tab} onNavigate={handleNavigate} />
      </aside>
      <div ref={scrollRootRef} data-scroll-root="route" onWheel={cancelScrollAlignment} onTouchStart={cancelScrollAlignment} onKeyDown={cancelScrollAlignment} className="min-w-0 min-h-0 flex-1 app-scroll app-scroll-y p-4 md:p-[calc(var(--ui-panel-padding)+4px)]">
        {children}
      </div>
    </section>
  );
}
