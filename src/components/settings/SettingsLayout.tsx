"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { isReducedMotionEnabled } from "@/lib/theme/appearance";
import { resolveSettingsTarget, sectionFromElementId, settingsSectionHref, settingsSectionId, type SettingsSection } from "@/lib/settings/navigation";
import { SettingsFind } from "@/components/settings/mix/SettingsFind";
import { useSettingsSummary } from "@/components/settings/mix/useSettingsSummary";
import { padCount } from "@/lib/ui/tab-marker";
import { cn } from "@/lib/utils";

type SettingsItem = { title: string; section: SettingsSection; href: string; danger?: boolean };
const settingsItems: SettingsItem[] = [
  { title: SETTINGS_SECTION_META.account.title, section: "account", href: settingsSectionHref("account") },
  { title: SETTINGS_SECTION_META.security.title, section: "security", href: settingsSectionHref("security") },
  { title: SETTINGS_SECTION_META.privacy.title, section: "privacy", href: settingsSectionHref("privacy") },
  { title: SETTINGS_SECTION_META.notifications.title, section: "notifications", href: settingsSectionHref("notifications") },
  { title: SETTINGS_SECTION_META.appearance.title, section: "appearance", href: settingsSectionHref("appearance") },
  { title: SETTINGS_SECTION_META.integrations.title, section: "integrations", href: settingsSectionHref("integrations") },
  { title: SETTINGS_SECTION_META["privacy-policies"].title, section: "privacy-policies", href: settingsSectionHref("privacy-policies") },
];
const deleteItem: SettingsItem = { title: SETTINGS_SECTION_META["delete-account"].title, section: "delete-account", href: settingsSectionHref("delete-account"), danger: true };

// How long a jump keeps correcting itself while content above it loads and changes height.
const ALIGN_WINDOW_MS = 4000;
// While a smooth scroll runs, the highlight stays on the section that was asked for.
const SMOOTH_SCROLL_MS = 900;

/**
 * The section nav (settings mix): hairline cells with a mono counter, a state only where something needs you
 * (VERIFY, 2FA OFF, PAUSED, a deletion date), and the clay marker sliding to the section you're in. Delete account
 * sits apart at the bottom; on a phone the nav is one sticky strip.
 */
function SettingsNav({ activeSection, onNavigate }: { activeSection: SettingsSection; onNavigate: (event: MouseEvent<HTMLAnchorElement>, item: SettingsItem) => void }) {
  const { states } = useSettingsSummary();
  const listRef = useRef<HTMLElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const link = (item: SettingsItem, index: number, className?: string) => {
    const state = states[item.section as keyof typeof states];
    return <Link key={`${item.section}-${className ?? ""}`} href={item.href} aria-current={activeSection === item.section ? "location" : undefined} onClick={(event) => onNavigate(event, item)} className={cn("nbs-nl", item.danger && "danger", className)}>
      <span className="n" aria-hidden="true">{padCount(index + 1)}</span>
      <span className="t">{item.title}</span>
      <span className="s">{state ? <><span className="sr-only">, </span>{state}</> : null}</span>
    </Link>;
  };
  // The marker follows the current link: down the left edge on a wide screen, along the bottom of the strip on a phone.
  useLayoutEffect(() => {
    const list = listRef.current;
    const marker = markerRef.current;
    if (!list || !marker) return;
    const place = () => {
      const current = list.querySelector<HTMLElement>('.nbs-nl[aria-current="location"]:not([hidden])');
      if (!current || current.offsetParent === null) { marker.style.opacity = "0"; return; }
      const strip = getComputedStyle(list).display === "flex";
      marker.style.opacity = "1";
      if (strip) {
        marker.style.width = `${current.offsetWidth}px`;
        marker.style.height = "";
        marker.style.transform = `translateX(${current.offsetLeft}px)`;
        // Keep the current cell in view by scrolling the strip itself, never its ancestors.
        if (current.offsetLeft < list.scrollLeft || current.offsetLeft + current.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = Math.max(0, current.offsetLeft - 16);
      } else {
        marker.style.width = "";
        marker.style.height = `${current.offsetHeight}px`;
        marker.style.transform = `translateY(${current.offsetTop}px)`;
      }
    };
    place();
    const sizes = new ResizeObserver(place);
    sizes.observe(list);
    return () => sizes.disconnect();
  }, [activeSection, states]);
  return <>
    <nav ref={listRef} aria-label="Settings sections" className="nbs-navlist">
      {settingsItems.map((item, index) => link(item, index))}
      {link(deleteItem, settingsItems.length, "only-phone")}
      <span ref={markerRef} className="nbs-marker" aria-hidden="true" />
    </nav>
    <div className="nbs-navfoot">{link(deleteItem, settingsItems.length)}</div>
  </>;
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
    // Scroll only the settings scroll root. scrollIntoView also scrolls every ancestor, including the app shell
    // (overflow hidden is still scrollable by script), which shoved the whole page up and left a blank band.
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const top = Math.max(0, root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - margin);
    root.scrollTo({ top, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    return true;
  }, []);

  /** Jump to an element, keep it there while the page settles, and move focus to its section heading. */
  const jumpTo = useCallback((elementId: string, { smooth, focus }: { smooth: boolean; focus: boolean }) => {
    spyPausedUntilRef.current = Date.now() + (smooth ? SMOOTH_SCROLL_MS : 150);
    alignRef.current = { elementId, until: Date.now() + ALIGN_WINDOW_MS };
    alignTo(elementId, smooth);
    if (!focus) return;
    const target = document.getElementById(elementId);
    if (!target) return;
    // A section: its heading takes focus. One setting inside a section: the setting itself, tinted for a moment.
    const section = target.hasAttribute("data-settings-section");
    const focusable = target.matches("h2, h3") ? target : section ? target.querySelector<HTMLElement>("h2") : target;
    if (focusable && !focusable.matches("h2, h3, a, button, input, select, textarea, [tabindex]")) focusable.setAttribute("tabindex", "-1");
    focusable?.focus({ preventScroll: true });
    if (!section) {
      target.classList.remove("nbs-flash");
      void target.offsetWidth;
      target.classList.add("nbs-flash");
      window.setTimeout(() => target.classList.remove("nbs-flash"), 1700);
    }
  }, [alignTo]);

  /** "Find a setting" chose a row: same as following its link. */
  const findJump = useCallback((elementId: string) => {
    const section = sectionFromElementId(elementId);
    if (section) setActiveSection(section);
    window.history.replaceState(window.history.state, "", `/settings#${elementId}`);
    jumpTo(elementId, { smooth: true, focus: true });
  }, [jumpTo]);

  // Land on what the address points at: a #hash, or the older ?tab= form (rewritten to a #hash so the address
  // and the highlight agree). Runs again if the address changes without a reload (Back, a link in the page).
  useEffect(() => {
    const land = (initial: boolean) => {
      const target = resolveSettingsTarget({ hash: window.location.hash, tab: new URLSearchParams(window.location.search).get("tab") });
      setActiveSection(target.section);
      // No hash, a hash outside Settings, or an older anchor that was renamed: the address shows where it landed.
      if (window.location.hash.slice(1) !== target.elementId) {
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
    <section className="nbs flex h-full min-h-0 w-full flex-col bg-background md:flex-row" aria-labelledby="settings-navigation-title">
      <div className="nbs-nav w-full shrink-0 border-b border-border bg-card md:w-[var(--nb-sidebar-width)] md:border-b-0 md:border-r">
        <div className="nbs-nav-head">
          {/* On a phone the page title is read but not drawn: the strip below is the whole header. */}
          <h1 id="settings-navigation-title" className="nbs-eyebrow max-md:sr-only">Settings</h1>
          <SettingsFind onJump={findJump} />
        </div>
        <SettingsNav activeSection={activeSection} onNavigate={handleNavigate} />
      </div>
      <div ref={scrollRootRef} data-scroll-root="route" onWheel={releaseAlignment} onTouchStart={releaseAlignment} onKeyDown={releaseAlignment} onPointerDown={releaseAlignment} className="relative min-w-0 min-h-0 flex-1 app-scroll app-scroll-y p-4 md:p-[calc(var(--ui-panel-padding)+4px)]">
        {children}
      </div>
    </section>
  );
}
