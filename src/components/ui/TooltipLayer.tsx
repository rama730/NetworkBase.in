"use client";

import { useEffect } from "react";
import { placeTip, tipDelay } from "@/lib/ui/tooltip-layer";

const CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"]';

/** The words a control's tooltip shows: an icon-only control's label, or the full text of a name that was cut off. */
function tipFor(el: Element): { text: string; kbd?: string } | null {
  if (el.closest('[data-slot="tooltip-trigger"], [data-no-tip]')) return null;
  const control = el.closest<HTMLElement>(`[data-tip], ${CONTROL}`);
  if (control) {
    const kbd = control.getAttribute("data-kbd") ?? control.getAttribute("aria-keyshortcuts") ?? undefined;
    if (control.dataset.tip) return { text: control.dataset.tip, kbd };
    const label = control.getAttribute("aria-label");
    const visible = [...control.childNodes].some((n) => n.nodeType === 3 ? n.textContent?.trim() : n instanceof HTMLElement && !n.matches("svg, .sr-only, [aria-hidden='true']") && n.textContent?.trim());
    if (label && !visible) return { text: label, kbd };
  }
  const cut = el.closest<HTMLElement>(".truncate, [data-trunc]");
  if (cut && cut.scrollWidth > cut.clientWidth + 1) return { text: cut.getAttribute("title") ?? cut.dataset.nbTitle ?? cut.textContent?.trim() ?? "" };
  return null;
}

/**
 * Controls round 2: one ink tooltip for the whole app, mounted once. Icon-only buttons and cut-off names get it with no
 * code at the call site; `data-tip` and `data-kbd` set the words and shortcut. 500 ms first, then instant while warm,
 * at once on keyboard focus, long press on touch. A browser `title` is set aside while ours shows, so there's only one.
 */
export function TooltipLayer() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "nb-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.appendChild(tip);
    let showing: HTMLElement | null = null, timer = 0, cool = 0, press = 0, warm = false;

    const anchorOf = (el: Element) => el.closest<HTMLElement>(`[data-tip], ${CONTROL}, .truncate, [data-trunc]`);
    const show = (el: HTMLElement, words: { text: string; kbd?: string }) => {
      if (!words.text) return;
      showing = el;
      const title = el.getAttribute("title");
      if (title !== null) { el.dataset.nbTitle = title; el.removeAttribute("title"); }
      tip.textContent = words.text;
      if (words.kbd) { const k = document.createElement("kbd"); k.textContent = words.kbd; tip.appendChild(k); }
      tip.hidden = false;
      const { top, left, side } = placeTip(el.getBoundingClientRect(), tip.getBoundingClientRect(), { width: window.innerWidth });
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
      tip.dataset.side = side;
      requestAnimationFrame(() => tip.setAttribute("data-on", ""));
      warm = true;
      window.clearTimeout(cool);
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (!showing) return;
      if (showing.dataset.nbTitle !== undefined) { showing.setAttribute("title", showing.dataset.nbTitle); delete showing.dataset.nbTitle; }
      showing = null;
      tip.removeAttribute("data-on");
      cool = window.setTimeout(() => { warm = false; if (!showing) tip.hidden = true; }, 300);
    };
    const queue = (target: EventTarget | null, keyboard: boolean) => {
      if (!(target instanceof Element)) return;
      const el = anchorOf(target);
      if (!el || el === showing) return;
      const words = tipFor(target);
      window.clearTimeout(timer);
      if (!words) return;
      timer = window.setTimeout(() => show(el, words), tipDelay({ warm, keyboard }));
    };

    const over = (e: PointerEvent) => { if (e.pointerType !== "touch") queue(e.target, false); };
    const out = (e: PointerEvent) => { const el = e.target instanceof Element ? anchorOf(e.target) : null; if (el && !el.contains(e.relatedTarget as Node | null)) hide(); };
    const focus = (e: FocusEvent) => { if (e.target instanceof Element && e.target.matches(":focus-visible")) queue(e.target, true); };
    const down = (e: PointerEvent) => {
      hide();
      if (e.pointerType !== "touch" || !(e.target instanceof Element)) return;
      const el = anchorOf(e.target), words = tipFor(e.target);
      if (el && words) press = window.setTimeout(() => show(el, words), 450);
    };
    const up = () => window.clearTimeout(press);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, { capture: true });
      tip.remove();
    };
  }, []);
  return null;
}
