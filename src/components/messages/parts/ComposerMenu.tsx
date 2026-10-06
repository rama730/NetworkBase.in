"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type ComposerMenuItem = { label: string; icon?: LucideIcon; onSelect: () => void; separatorBefore?: boolean };

const coarse = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * A composer menu (+, schedule): a dropdown with a mouse, a bottom sheet with 44px rows on
 * touch (spec: pickers on phones are sheets, never small floating menus).
 */
export function ComposerMenu({ title, trigger, items, side = "top", align = "start", disabled = false, triggerProps }: {
  title: string;
  trigger: React.ReactNode;
  items: ComposerMenuItem[];
  side?: "top" | "bottom";
  align?: "start" | "end";
  disabled?: boolean;
  triggerProps: React.ButtonHTMLAttributes<HTMLButtonElement> & { className: string };
}) {
  const [sheet, setSheet] = useState(false);
  if (coarse()) {
    return (
      <>
        <button type="button" {...triggerProps} aria-haspopup="dialog" aria-disabled={disabled || undefined} onClick={() => !disabled && setSheet(true)}>{trigger}</button>
        <Dialog open={sheet} onOpenChange={setSheet}>
          <DialogContent presentation="bottom-sheet" className="px-2 pb-2">
            <DialogTitle className="nb-micro px-3 pb-1 pt-4">{title}</DialogTitle>
            <ul>
              {items.map((item) => (
                <li key={item.label} className={item.separatorBefore ? "mt-1 border-t border-border pt-1" : undefined}>
                  <button
                    type="button"
                    onClick={() => {
                      setSheet(false);
                      item.onSelect();
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] hover:bg-muted"
                  >
                    {item.icon ? <item.icon size={18} className="text-muted-foreground" aria-hidden="true" /> : null}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <DropdownMenu>
      {/* aria-disabled, not disabled: the trigger stays focusable and its title says why. */}
      <DropdownMenuTrigger {...triggerProps} aria-disabled={disabled || undefined} onPointerDown={(e) => disabled && e.preventDefault()} onKeyDown={(e) => disabled && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") && e.preventDefault()}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-56">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {items.map((item) => (
          <span key={item.label} className="contents">
            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={item.onSelect}>
              {item.icon ? <item.icon /> : null}
              {item.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
