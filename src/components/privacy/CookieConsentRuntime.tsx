"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  CookieConsentDecision,
  OPEN_COOKIE_SETTINGS_EVENT,
  createCookieConsentDecision,
  readCookieConsentDecision,
  writeCookieConsentDecision,
} from "@/lib/privacy/cookie-consent";

const CookieConsentPanel = dynamic(() => import("./CookieConsentPanel"), { ssr: false });

const AUTH_ENTRY_PATHS = new Set(["/login", "/signup"]);

export function CookieConsentRuntime() {
  const pathname = usePathname();
  const [decision, setDecision] = useState<CookieConsentDecision | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [analyticsChoice, setAnalyticsChoice] = useState(false);

  const openSettings = useCallback(() => {
    const current = readCookieConsentDecision();
    setDecision(current);
    setAnalyticsChoice(current?.analytics ?? false);
    setIsCustomizing(Boolean(current));
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const current = readCookieConsentDecision();
    setDecision(current);
    setAnalyticsChoice(current?.analytics ?? false);
    setIsReady(true);

    if (!current && AUTH_ENTRY_PATHS.has(pathname)) {
      setIsOpen(true);
    }
  }, [pathname]);

  useEffect(() => {
    const handleOpen = () => openSettings();
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<CookieConsentDecision>).detail;
      setDecision(next ?? readCookieConsentDecision());
    };

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, handleOpen);
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, handleOpen);
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleChange);
    };
  }, [openSettings]);

  const saveChoice = useCallback((analytics: boolean) => {
    const next = createCookieConsentDecision(analytics);
    writeCookieConsentDecision(next);
    setDecision(next);
    setAnalyticsChoice(analytics);
    setIsCustomizing(false);
    setIsOpen(false);
  }, []);

  return isReady && isOpen ? (
    <CookieConsentPanel
      compact={AUTH_ENTRY_PATHS.has(pathname)}
      hasDecision={Boolean(decision)}
      isCustomizing={isCustomizing}
      analyticsChoice={analyticsChoice}
      onClose={() => setIsOpen(false)}
      onCustomize={() => setIsCustomizing(true)}
      onBack={() => setIsCustomizing(false)}
      onAnalyticsChange={setAnalyticsChoice}
      onSave={saveChoice}
    />
  ) : null;
}
