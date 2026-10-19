"use client";

import * as React from "react";
import { openCookieSettings } from "@/lib/privacy/cookie-consent";
import { cn } from "@/lib/utils";

export const CookieSettingsButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function CookieSettingsButton({ className, onClick, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn("underline-offset-4 hover:text-foreground hover:underline", className)}
      onClick={(e) => {
        openCookieSettings();
        onClick?.(e);
      }}
      {...props}
    >
      Cookie settings
    </button>
  );
});

CookieSettingsButton.displayName = "CookieSettingsButton";
