"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBack } from "@/hooks/useBack";
import { backLabel, backTargetFor, shortTitle } from "@/lib/navigation/back-routes";
import { currentEntry, subscribeEntry } from "@/lib/navigation/in-app-history";
import { useUIStore } from "@/stores/ui-store";

const serverEntry = () => null;

/** "Back to <the page you came from>", or "Back" (B14). */
function useBackLabel() {
  const entry = useSyncExternalStore(subscribeEntry, currentEntry, serverEntry);
  return backLabel(entry?.from ? { title: shortTitle(entry.from.title) } : null);
}

/** Whether this page shows the arrow, where it goes, and whether it may animate (§7.4). */
function useBackArrow() {
  const pathname = usePathname() ?? "";
  const target = backTargetFor(pathname);
  const parent = useUIStore((state) => state.backParent);
  const go = useBack(parent ?? target.fallback);
  // A fresh load or refresh shows the final state; motion starts with the first in-app move.
  const firstPath = useRef(pathname);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (pathname !== firstPath.current) setAnimate(true);
  }, [pathname]);
  return { show: target.show, animate, label: useBackLabel(), go };
}

function ArrowButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`nb-icon-button nb-back-arrow size-[var(--ui-control-height)] max-md:size-11 ${className}`}>
      <ArrowLeft className="size-[18px]" aria-hidden="true" />
    </button>
  );
}

/** Desktop: a slot before the search box that grows to the arrow's width; the search narrows by itself. */
export function BackSlot() {
  const { show, animate, label, go } = useBackArrow();
  return (
    <div className="nb-back-slot" data-show={show} data-animate={animate} inert={!show} aria-hidden={!show}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ArrowButton label={label} onClick={go} />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Phone: the arrow takes the logo's place next to the menu button. */
export function BackLogoSwap({ logo }: { logo: ReactNode }) {
  const { show, animate, label, go } = useBackArrow();
  return (
    <div className="nb-back-swap" data-show={show} data-animate={animate}>
      <span className="nb-back-logo" inert={show} aria-hidden={show}>{logo}</span>
      <span className="nb-back-swap-arrow" inert={!show} aria-hidden={!show}>
        <ArrowButton label={label} onClick={go} />
      </span>
    </div>
  );
}

/** Outside the top bar (not-found, legal, admin pages): the same arrow, always shown (A1). */
export function BackButton({ fallback = "/discover", className = "" }: { fallback?: string; className?: string }) {
  return <ArrowButton label={useBackLabel()} onClick={useBack(fallback)} className={className} />;
}
