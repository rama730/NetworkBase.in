"use client";

import { LEGAL_PAGE_NAMES } from "@/lib/copy/terms";
import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CookieSettingsButton } from "@/components/privacy/CookieSettingsButton";
import { cn } from "@/lib/utils";

const LINK_CLASS =
  "inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline transition-colors focus-visible:underline rounded-sm pointer-coarse:min-h-11 pointer-coarse:items-center";

export function LegalLinks({
  className,
  showCopyright = false,
  align = "center",
}: {
  className?: string;
  showCopyright?: boolean;
  align?: "center" | "start" | "end";
}) {
  const isStart = align === "start";
  const isEnd = align === "end";
  const alignClass = isStart
    ? "justify-start text-left"
    : isEnd
    ? "justify-end text-right"
    : "justify-center text-center";
  const menuAlign = isStart ? "start" : isEnd ? "end" : "center";

  const nav = (
    <nav
      aria-label="Legal and support links"
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground max-sm:gap-x-3 max-sm:gap-y-0",
        alignClass,
        !showCopyright && className
      )}
    >
      {/* 1. Contact */}
      <a
        className={LINK_CLASS}
        href="mailto:support@networkbase.in"
      >
        Contact
      </a>

      {/* 2. Support */}
      <Link className={LINK_CLASS} href="/support">
        Support
      </Link>

      {/* 3. Privacy tab */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(LINK_CLASS, "cursor-pointer select-none")}
          aria-label="Privacy links"
        >
          <span>Privacy</span>
          <ChevronDown className="size-3 text-muted-foreground/70" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align={menuAlign} className="min-w-[190px] p-1.5 shadow-md">
          <DropdownMenuItem asChild>
            <Link href="/privacy" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.privacy}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/cookies" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.cookies}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <CookieSettingsButton className="w-full text-left no-underline hover:no-underline font-normal cursor-pointer" />
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/subprocessors" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.subprocessors}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 4. Security tab */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(LINK_CLASS, "cursor-pointer select-none")}
          aria-label="Security links"
        >
          <span>Security</span>
          <ChevronDown className="size-3 text-muted-foreground/70" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align={menuAlign} className="min-w-[190px] p-1.5 shadow-md">
          <DropdownMenuItem asChild>
            <Link href="/security-reporting" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.security}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/grievances" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.grievances}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 5. Terms tab */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(LINK_CLASS, "cursor-pointer select-none")}
          aria-label="Terms links"
        >
          <span>Terms</span>
          <ChevronDown className="size-3 text-muted-foreground/70" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align={menuAlign} className="min-w-[210px] p-1.5 shadow-md">
          <DropdownMenuItem asChild>
            <Link href="/terms" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.terms}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/eula" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.eula}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/acceptable-use" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.acceptableUse}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/copyright" className="cursor-pointer">
              {LEGAL_PAGE_NAMES.copyright}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );

  if (!showCopyright) {
    return nav;
  }

  return (
    <div className={cn("space-y-1.5", alignClass, className)}>
      {nav}
      {showCopyright && (
        // The year can differ between server and browser at New Year; either is right.
        <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
          © {new Date().getFullYear()} NetworkBase. All rights reserved.
        </p>
      )}
    </div>
  );
}
