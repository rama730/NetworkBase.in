"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

import { withStaleActionNotice } from "@/lib/deployment/stale-action";
import { createCsrfFetch } from "@/lib/security/csrf-client";

const SecurityRuntimeContext = createContext<{ nonce: string | null }>({ nonce: null });
const FETCH_PATCH_SYMBOL = Symbol.for("networkbase.security.fetch.patch");

export function isSameOriginRequest(input: RequestInfo | URL, currentOrigin = window.location.origin) {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input instanceof Request
        ? input.url
        : String(input);

  try {
    return new URL(rawUrl, currentOrigin).origin === currentOrigin;
  } catch {
    return false;
  }
}

export function SecurityRuntimeProvider({
  nonce,
  children,
}: {
  nonce: string | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const target = window as Window & { [FETCH_PATCH_SYMBOL]?: typeof window.fetch };
    if (!target[FETCH_PATCH_SYMBOL]) {
      target[FETCH_PATCH_SYMBOL] = window.fetch.bind(window);
    }
    const originalFetch = target[FETCH_PATCH_SYMBOL]!;

    window.fetch = createCsrfFetch(withStaleActionNotice(originalFetch), (input) => isSameOriginRequest(input));

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const value = useMemo(() => ({ nonce }), [nonce]);

  return (
    <SecurityRuntimeContext.Provider value={value}>
      {children}
    </SecurityRuntimeContext.Provider>
  );
}

export function useSecurityRuntime() {
  return useContext(SecurityRuntimeContext);
}
