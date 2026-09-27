"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Bell, ChevronDown, Lock, Palette, Plug, Scale, Shield, User, type LucideIcon } from "lucide-react";
import { settingsTabHref } from "@/constants/routes";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { cn } from "@/lib/utils";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";

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
  const warmPrefetchRoute = useRouteWarmPrefetch();
  return <nav aria-label="Settings sections" className="space-y-1">{settingsItems.map((item) => {
    const Icon = item.icon;
    const active = activeTab === item.tab;
    return <Link key={item.tab} href={item.href} prefetch={false} aria-current={active ? "page" : undefined} onClick={(event) => onNavigate(event, item)} onPointerEnter={() => warmPrefetchRoute(item.href)} onFocus={() => warmPrefetchRoute(item.href)} className={cn("group flex min-h-16 items-start gap-3 rounded-md px-3 py-3 transition-colors duration-[130ms]", active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", active ? "bg-background text-primary ring-1 ring-inset ring-border" : "bg-muted text-muted-foreground")}><Icon className="size-4" strokeWidth={1.75} aria-hidden="true" /></span>
      <span className="min-w-0"><span className="nb-ui-label block text-foreground">{item.title}</span><span className="nb-compact mt-0.5 block text-muted-foreground">{item.description}</span></span>
    </Link>;
  })}</nav>;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedTab = searchParams.get("tab") ?? "account";
  const [activeTab, setActiveTab] = useState(requestedTab);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const locallyNavigatedTabRef = useRef<{ tab: string } | null>(null);
  const hasMountedRef = useRef(false);
  const active = settingsItems.find((item) => item.tab === activeTab) ?? settingsItems[0]!;
  const ActiveIcon = active.icon;

  const scrollToSection = useCallback((tab: string, behavior: ScrollBehavior = "smooth", useHash = false) => {
    const hashTarget = useHash && window.location.hash
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    const target = hashTarget ?? document.getElementById(`settings-${tab}`);
    if (!target) return;
    target.scrollIntoView({ behavior, block: "start" });
  }, []);

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
    if (requestedTab === "account" && !window.location.hash) return;
    const frame = window.requestAnimationFrame(() => scrollToSection(requestedTab, behavior, true));
    return () => window.cancelAnimationFrame(frame);
  }, [requestedTab, scrollToSection]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const updateActiveSection = () => {
      const rootTop = root.getBoundingClientRect().top;
      let closest = settingsItems.at(-1)?.tab ?? "account";
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
      setActiveTab(closest);
    };
    updateActiveSection();
    root.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => root.removeEventListener("scroll", updateActiveSection);
  }, [requestedTab]);

  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>, item: SettingsItem) => {
    event.preventDefault();
    const localNavigation = { tab: item.tab };
    locallyNavigatedTabRef.current = localNavigation;
    router.replace(item.href, { scroll: false });
    scrollToSection(item.tab);
    window.setTimeout(() => {
      if (locallyNavigatedTabRef.current === localNavigation) locallyNavigatedTabRef.current = null;
    }, 1000);
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  return (
    <div ref={scrollRootRef} data-scroll-root="route" className="h-full min-h-0 w-full app-scroll app-scroll-y app-scroll-gutter">
      <div className="mx-auto grid min-h-full w-full max-w-[1320px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="nb-settings-local-nav hidden w-[248px] self-start lg:block"><div className="nb-settings-local-nav-panel app-scroll app-scroll-y app-scroll-hidden rounded-lg border border-border bg-card p-2"><div className="px-3 pb-3 pt-2"><div className="nb-card-title text-foreground">Settings</div><div className="nb-compact mt-0.5 text-muted-foreground">Account & preferences</div></div><SettingsNav activeTab={active.tab} onNavigate={handleNavigate} /></div></aside>
        <main className="min-w-0"><details className="sticky top-0 z-20 mb-4 rounded-lg bg-background pb-2 lg:hidden"><summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-border bg-card p-3"><span className="flex min-w-0 items-center gap-3"><span className="flex size-9 items-center justify-center rounded-md bg-muted"><ActiveIcon className="size-4 text-muted-foreground" strokeWidth={1.75} /></span><span><span className="nb-ui-label block text-foreground">{active.title}</span><span className="nb-compact block truncate text-muted-foreground">{active.description}</span></span></span><ChevronDown className="size-4 text-muted-foreground" /></summary><div className="mt-2 rounded-lg border border-border bg-card p-2"><SettingsNav activeTab={active.tab} onNavigate={handleNavigate} /></div></details><div className="space-y-6">{children}</div></main>
      </div>
    </div>
  );
}
