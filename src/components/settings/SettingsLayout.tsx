"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Bell, Lock, Palette, Plug, Scale, Shield, Trash2, User, type LucideIcon } from "lucide-react";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { isReducedMotionEnabled } from "@/lib/theme/appearance";
import { resolveSettingsTarget, sectionFromElementId, settingsSectionHref, settingsSectionId, type SettingsSection } from "@/lib/settings/navigation";
import { cn } from "@/lib/utils";

type SettingsItem = { title: string; section: SettingsSection; href: string; icon: LucideIcon; danger?: boolean };
const settingsItems: SettingsItem[] = [
  { title: SETTINGS_SECTION_META.account.title, section: "account", href: settingsSectionHref("account"), icon: User },
  { title: SETTINGS_SECTION_META.security.title, section: "security", href: settingsSectionHref("security"), icon: Shield },
  { title: SETTINGS_SECTION_META.privacy.title, section: "privacy", href: settingsSectionHref("privacy"), icon: Lock },
  { title: SETTINGS_SECTION_META.notifications.title, section: "notifications", href: settingsSectionHref("notifications"), icon: Bell },
  { title: SETTINGS_SECTION_META.appearance.title, section: "appearance", href: settingsSectionHref("appearance"), icon: Palette },
  { title: SETTINGS_SECTION_META.integrations.title, section: "integrations", href: settingsSectionHref("integrations"), icon: Plug },
  { title: SETTINGS_SECTION_META["privacy-policies"].title, section: "privacy-policies", href: settingsSectionHref("privacy-policies"), icon: Scale },
  { title: "Delete account", section: "delete-account", href: settingsSectionHref("delete-account"), icon: Trash2, danger: true },
];

// How long a jump keeps correcting itself while content above it loads and changes height.
const ALIGN_WINDOW_MS = 4000;
// While a smooth scroll runs, the highlight stays on the section that was asked for.
const SMOOTH_SCROLL_MS = 900;

function SettingsNav({ activeSection, onNavigate }: { activeSection: SettingsSection; onNavigate: (event: MouseEvent<HTMLAnchorElement>, item: SettingsItem) => void }) {
  return <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pr-1 md:flex-col md:overflow-visible">{settingsItems.map((item) => {
    const Icon = item.icon;
    const active = activeSection === item.section;
    return <Link key={item.section} href={item.href} aria-current={active ? "location" : undefined} onClick={(event) => onNavigate(event, item)} className={cn("nb-nav-link min-w-0 shrink-0 focus-visible:brightness-95 md:shrink", item.danger && "text-[var(--status-danger)]")}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 whitespace-nowrap md:truncate">{item.title}</span>
    </Link>;
  })}</nav>;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => resolveSettingsTarget({ tab: requestedTab }).section);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  // The element a jump is aimed at, kept in place until the person scrolls themselves.
  const alignRef = useRef<{ elementId: string; until: number } | null>(null);
  const spyPausedUntilRef = useRef(0);

  const reducedMotion = () => isReducedMotionEnabled({ root: document.documentElement, matchMedia: window.matchMedia?.bind(window) });

  const alignTo = useCallback((elementId: string, smooth: boolean) => {
    const root = scrollRootRef.current;
    const target = document.getElementById(elementId);
    if (!target || !root?.contains(target)) return false;
    target.scrollIntoView({ behavior: smooth && !reducedMotion() ? "smooth" : "auto", block: "start" });
    return true;
  }, []);

  /** Jump to an element, keep it there while the page settles, and move focus to its section heading. */
  const jumpTo = useCallback((elementId: string, { smooth, focus }: { smooth: boolean; focus: boolean }) => {
    spyPausedUntilRef.current = Date.now() + (smooth ? SMOOTH_SCROLL_MS : 150);
    alignRef.current = { elementId, until: Date.now() + ALIGN_WINDOW_MS };
    alignTo(elementId, smooth);
    if (!focus) return;
    const target = document.getElementById(elementId);
    const heading = target?.matches("h2, h3") ? target : target?.querySelector<HTMLElement>("h2");
    heading?.focus({ preventScroll: true });
  }, [alignTo]);

  // Land on what the address points at: a #hash, or the older ?tab= form (rewritten to a #hash so the address
  // and the highlight agree). Runs again if the address changes without a reload (Back, a link in the page).
  useEffect(() => {
    const land = (initial: boolean) => {
      const target = resolveSettingsTarget({ hash: window.location.hash, tab: new URLSearchParams(window.location.search).get("tab") });
      setActiveSection(target.section);
      if (!window.location.hash || sectionFromElementId(window.location.hash.slice(1)) === null) {
        window.history.replaceState(window.history.state, "", `/settings#${target.elementId}`);
      }
      // Only a link the person followed moves focus; the first paint of the page does not steal it.
      window.requestAnimationFrame(() => jumpTo(target.elementId, { smooth: !initial, focus: !initial }));
    };
    land(true);
    const onHashChange = () => land(false);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // The initial landing is the only one tied to ?tab=; later changes arrive as hashchange events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  // Sections grow as their data arrives. While a jump is still fresh and the person hasn't scrolled, keep the
  // target at the top; and pick up sections that mount after the first render (the page streams in).
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const realign = () => {
      const pending = alignRef.current;
      if (!pending) return;
      if (Date.now() > pending.until) { alignRef.current = null; return; }
      alignTo(pending.elementId, false);
    };
    const resize = new ResizeObserver(realign);
    const watch = () => {
      resize.disconnect();
      const document_ = root.querySelector("[data-settings-document]");
      if (document_) resize.observe(document_);
      realign();
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(root, { childList: true });
    return () => { resize.disconnect(); mutations.disconnect(); };
  }, [alignTo]);

  // Which section is at the top as you scroll: the first one crossing a line near the top of the page.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const visible = new Set<Element>();
    let observer: IntersectionObserver | null = null;
    let sections: HTMLElement[] = [];
    let recheck: number | null = null;
    // Picks the first section on the line. While a jump is still settling it waits, then looks again, so a
    // scroll that happened meanwhile is not lost.
    const evaluate = () => {
      const wait = spyPausedUntilRef.current - Date.now();
      if (wait > 0) {
        if (recheck !== null) window.clearTimeout(recheck);
        recheck = window.setTimeout(evaluate, wait + 20);
        return;
      }
      const first = sections.find((section) => visible.has(section));
      const section = sectionFromElementId(first?.id);
      if (section) setActiveSection(section);
    };
    const observe = () => {
      observer?.disconnect();
      visible.clear();
      sections = Array.from(root.querySelectorAll<HTMLElement>("[data-settings-section]"));
      if (!sections.length) return;
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
        }
        evaluate();
      }, { root, rootMargin: "-72px 0px -60% 0px" });
      sections.forEach((section) => observer!.observe(section));
    };
    observe();
    const mutations = new MutationObserver(observe);
    mutations.observe(root, { childList: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      if (recheck !== null) window.clearTimeout(recheck);
    };
  }, []);

  // Scrolling, tapping the page or typing hands control back: the jump stops correcting itself.
  const releaseAlignment = useCallback(() => { alignRef.current = null; }, []);

  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>, item: SettingsItem) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setActiveSection(item.section);
    window.history.replaceState(window.history.state, "", item.href);
    jumpTo(settingsSectionId(item.section), { smooth: true, focus: true });
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-card md:flex-row" aria-labelledby="settings-navigation-title">
      <div className="w-full min-h-0 shrink-0 overflow-y-auto border-b border-border bg-card px-3 py-3 md:w-[var(--nb-sidebar-width)] md:border-b-0 md:border-r md:py-4">
        <div className="space-y-3 px-2 pr-3 md:mb-3">
          {/* On a phone the page title is read but not drawn: the chips below are the whole header. */}
          <h1 id="settings-navigation-title" className="nb-micro max-md:sr-only">Settings</h1>
          <div className="hidden h-px w-full bg-border md:block" aria-hidden="true" />
        </div>
        <SettingsNav activeSection={activeSection} onNavigate={handleNavigate} />
      </div>
      <div ref={scrollRootRef} data-scroll-root="route" onWheel={releaseAlignment} onTouchStart={releaseAlignment} onKeyDown={releaseAlignment} onPointerDown={releaseAlignment} className="min-w-0 min-h-0 flex-1 app-scroll app-scroll-y p-4 md:p-[calc(var(--ui-panel-padding)+4px)]">
        {children}
      </div>
    </section>
  );
}
