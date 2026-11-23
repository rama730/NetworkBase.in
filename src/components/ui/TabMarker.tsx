"use client";

import { useLayoutEffect, useRef } from "react";
import { markerBox } from "@/lib/ui/tab-marker";

const OPEN = '[role="tab"][aria-selected="true"], [role="tab"][data-state="active"], [role="radio"][aria-checked="true"], [aria-current="page"], :scope > [aria-pressed="true"]';

/**
 * The one clay marker (controls round 2): put it inside any tab list or segmented row and it slides, 300 ms, to the open
 * tab. The list's tabs then drop their own underline (globals.css, [data-marker]). `overlap` sits it on the list's
 * bottom hairline, for underline tabs.
 */
export function TabMarker({ overlap = false }: { overlap?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const marker = ref.current;
    const list = marker?.parentElement;
    if (!marker || !list) return;
    let placed = false;
    const place = () => {
      const tab = list.querySelector<HTMLElement>(OPEN);
      if (!tab) { marker.style.opacity = "0"; return; }
      const { left, width } = markerBox(list.getBoundingClientRect(), tab.getBoundingClientRect(), list.scrollLeft);
      marker.style.transition = placed ? "" : "none";
      marker.style.opacity = "1";
      marker.style.width = `${width}px`;
      marker.style.transform = `translateX(${left}px)`;
      placed = true;
    };
    list.setAttribute("data-marker", "");
    place();
    const mutations = new MutationObserver(place);
    mutations.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "data-state", "aria-checked", "aria-current", "aria-pressed"] });
    const sizes = new ResizeObserver(place);
    sizes.observe(list);
    void document.fonts?.ready.then(place);
    return () => { mutations.disconnect(); sizes.disconnect(); list.removeAttribute("data-marker"); };
  }, []);
  return <span ref={ref} className="nb-tab-marker" data-overlap={overlap || undefined} aria-hidden="true" />;
}
