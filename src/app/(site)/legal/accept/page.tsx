"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthAlert, AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { normalizeAuthNextPath } from "@/lib/auth/redirects";

export default function LegalAcceptancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOAuthSignup = searchParams.get("context") === "oauth_signup";
  // Arriving here is only a request to accept: someone who already has has nothing to do, so they go straight on.
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/legal/acceptance", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (payload?.data?.current === true) router.replace(normalizeAuthNextPath(searchParams.get("next")));
        else setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  async function continueToNetworkBase() {
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/legal/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepted: true,
          context: isOAuthSignup ? "oauth_signup" : "material_update",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.message || payload?.error || "Couldn’t record acceptance");
      router.replace(normalizeAuthNextPath(searchParams.get("next")));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t record acceptance");
      setSubmitting(false);
    }
  }

  const panel = isOAuthSignup
    ? { eyebrow: "Almost there", title: "One agreement, then you’re in." }
    : { eyebrow: "Updated terms", title: "What you agree to, in plain view." };

  if (checking) {
    return (
      <AuthShell title="Before you continue" description="Checking your agreement…" panel={panel}>
        <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />
      </AuthShell>
    );
  }

  const docLink = "font-medium text-foreground underline underline-offset-2 hover:text-primary";
  return (
    <AuthShell
      title="Before you continue"
      description={isOAuthSignup
        ? "Your account is connected. Review and accept NetworkBase’s current terms to finish creating it."
        : "We’ve updated the wording of our terms. Nothing about your rights has changed. Accept the current versions to keep using NetworkBase."}
      panel={panel}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
          {([["Terms", LEGAL_VERSIONS.terms, "/terms"], ["EULA", LEGAL_VERSIONS.eula, "/eula"], ["Privacy", LEGAL_VERSIONS.privacy, "/privacy"]] as const).map(([label, version, href]) => (
            <a key={label} href={href} target="_blank" className="rounded-md border border-border bg-card p-2 hover:border-foreground">
              {label}<br /><strong className="font-mono text-foreground">{version}</strong>
            </a>
          ))}
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-4 text-sm leading-6">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
          <span>I am at least 18 years old, accept the <a href="/terms" target="_blank" className={docLink}>Terms of Service</a> and <a href="/eula" target="_blank" className={docLink}>EULA</a>, and acknowledge the <a href="/privacy" target="_blank" className={docLink}>Privacy Policy</a>.</span>
        </label>
        {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
        <Button type="button" disabled={!confirmed || submitting} onClick={() => void continueToNetworkBase()} className="h-11 w-full font-medium">
          {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null} Agree and continue
        </Button>
      </div>
    </AuthShell>
  );
}
