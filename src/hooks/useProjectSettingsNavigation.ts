"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectSettingsSection } from "@/components/projects/settings/ProjectSettingsNavigation";
import type { ProjectSettingsSectionId } from "@/lib/projects/settings-policies";
import {
  resolveProjectSettingsSection,
  selectVisibleSettingsSection,
} from "@/lib/projects/settings-navigation";

export function useProjectSettingsNavigation(
  sections: ProjectSettingsSection[],
) {
  const router = useRouter();
  const params = useSearchParams();
  const [activeSection, setActiveSection] = useState(() =>
    resolveProjectSettingsSection(
      params.get("settings") || params.get("section"),
      sections,
    ),
  );
  const targetRef = useRef<ProjectSettingsSectionId | null>(null);
  const anchorRef = useRef<ProjectSettingsSectionId | null>(null);
  const targetTopRef = useRef(0);
  const localRef = useRef<ProjectSettingsSectionId | null>(null);
  const initialRef = useRef(true);

  const scrollToSection = useCallback(
    (id: ProjectSettingsSectionId, smooth: boolean) => {
      const scrollRoot = document.querySelector<HTMLElement>(
        '[data-scroll-root="route"]',
      );
      const target = document.getElementById(`project-settings-${id}`);
      if (!scrollRoot || !target) return;
      const stickyTabsHeight =
        document.querySelector<HTMLElement>('[data-project-sticky-tabs="true"]')
          ?.offsetHeight ?? 0;
      const selectorHeight =
        scrollRoot
          .querySelector<HTMLElement>("[data-project-settings-selector]")
          ?.getBoundingClientRect().height ?? 0;
      const offset = stickyTabsHeight + selectorHeight + 16;
      targetRef.current = id;
      anchorRef.current = id;
      setActiveSection(id);
      targetTopRef.current = Math.min(
        scrollRoot.scrollHeight - scrollRoot.clientHeight,
        Math.max(
          0,
          scrollRoot.scrollTop +
            target.getBoundingClientRect().top -
            scrollRoot.getBoundingClientRect().top -
            offset,
        ),
      );
      scrollRoot.scrollTo({
        top: targetTopRef.current,
        left: scrollRoot.scrollLeft,
        behavior:
          smooth &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "smooth"
            : "auto",
      });
    },
    [],
  );

  const navigate = useCallback(
    (id: ProjectSettingsSectionId) => {
      localRef.current = id;
      const next = new URLSearchParams(window.location.search);
      next.set("tab", "settings");
      next.set("settings", id);
      router.push(`?${next.toString()}#project-settings-${id}`, {
        scroll: false,
      });
      scrollToSection(id, true);
    },
    [router, scrollToSection],
  );

  useEffect(() => {
    const align = () => {
      const hash = window.location.hash.startsWith("#project-settings-")
        ? window.location.hash
        : null;
      const currentParams = new URLSearchParams(window.location.search);
      const requested =
        hash || currentParams.get("settings") || currentParams.get("section");
      const id = resolveProjectSettingsSection(requested, sections);
      if (localRef.current === id) {
        localRef.current = null;
        return;
      }
      if (!requested) {
        const root = document.querySelector<HTMLElement>(
          '[data-scroll-root="route"]',
        );
        targetRef.current = null;
        anchorRef.current = null;
        setActiveSection(id);
        root?.scrollTo({ top: 0, left: root.scrollLeft, behavior: "auto" });
      } else scrollToSection(id, !initialRef.current);
      initialRef.current = false;
    };
    const frame = requestAnimationFrame(align);
    window.addEventListener("hashchange", align);
    window.addEventListener("popstate", align);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", align);
      window.removeEventListener("popstate", align);
    };
  }, [params, sections, scrollToSection]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-scroll-root="route"]',
    );
    if (!root) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (targetRef.current) {
          if (Math.abs(root.scrollTop - targetTopRef.current) > 2) return;
          targetRef.current = null;
        }
        const contentTop =
          root.getBoundingClientRect().top +
          (document.querySelector<HTMLElement>(
            '[data-project-sticky-tabs="true"]',
          )?.offsetHeight ?? 0) +
          (root
            .querySelector<HTMLElement>("[data-project-settings-selector]")
            ?.getBoundingClientRect().height ?? 0) +
          16;
        const visible = selectVisibleSettingsSection(
          sections.flatMap((section) => {
            const node = document.getElementById(
              `project-settings-${section.id}`,
            );
            return node
              ? [
                  {
                    id: section.id,
                    top: node.getBoundingClientRect().top,
                    bottom: node.getBoundingClientRect().bottom,
                  },
                ]
              : [];
          }),
          contentTop,
          root.scrollTop > 0 &&
            root.scrollHeight - root.clientHeight - root.scrollTop <= 2,
        );
        if (visible) setActiveSection(visible);
      });
    };
    const release = () => {
      targetRef.current = null;
      update();
    };
    const interrupt = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        ![
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        return;
      anchorRef.current = null;
      release();
    };
    const onScroll = () => {
      if (!targetRef.current) anchorRef.current = null;
      update();
    };
    const observer = new ResizeObserver(() => {
      // Loading sections above a deep link must not move its heading away.
      // Once the user scrolls or interacts, their position takes precedence.
      const anchor = anchorRef.current;
      if (anchor) {
        const node = document.getElementById(`project-settings-${anchor}`);
        const offset =
          (document.querySelector<HTMLElement>(
            '[data-project-sticky-tabs="true"]',
          )?.offsetHeight ?? 0) +
          (root
            .querySelector<HTMLElement>("[data-project-settings-selector]")
            ?.getBoundingClientRect().height ?? 0) +
          16;
        if (node) {
          const nextTop = Math.min(
            root.scrollHeight - root.clientHeight,
            Math.max(
              0,
              root.scrollTop +
                node.getBoundingClientRect().top -
                root.getBoundingClientRect().top -
                offset,
            ),
          );
          if (Math.abs(nextTop - targetTopRef.current) > 2) {
            targetTopRef.current = nextTop;
            targetRef.current = anchor;
            root.scrollTo({
              top: nextTop,
              left: root.scrollLeft,
              behavior: "auto",
            });
          }
        }
      }
      update();
    });
    root
      .querySelectorAll("[data-project-settings-section]")
      .forEach((node) => observer.observe(node));
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("scrollend", release);
    root.addEventListener("wheel", interrupt, { passive: true });
    root.addEventListener("touchstart", interrupt, { passive: true });
    root.addEventListener("keydown", interrupt);
    root.addEventListener("pointerdown", interrupt);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("scrollend", release);
      root.removeEventListener("wheel", interrupt);
      root.removeEventListener("touchstart", interrupt);
      root.removeEventListener("keydown", interrupt);
      root.removeEventListener("pointerdown", interrupt);
    };
  }, [sections]);
  return { activeSection, navigate };
}
