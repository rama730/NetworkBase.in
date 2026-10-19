"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, ExternalLink, Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSIONS } from "@/lib/legal/versions";

type AcceptanceState = {
  current: boolean;
  latest: {
    acceptedAt: string;
    termsVersion: string;
    eulaVersion: string;
    privacyNoticeVersion: string;
  } | null;
};

const governingDocuments = [
  { href: "/terms", title: "Terms of Service" },
  { href: "/privacy", title: "Privacy Policy" },
  { href: "/eula", title: "End User Licence Agreement" },
  { href: "/acceptable-use", title: "Acceptable Use Policy" },
  { href: "/cookies", title: "Cookies & Local Storage" },
  { href: "/subprocessors", title: "Service Providers" },
  { href: "/security-reporting", title: "Security Reporting" },
  { href: "/grievances", title: "Grievances & Redressal" },
] as const;

export function LegalAndDataRightsSection() {
  const [state, setState] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const loadStatus = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    fetch("/api/v1/legal/acceptance", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload?.success === false) {
          throw new Error("Acceptance status unavailable");
        }
        return payload.data as AcceptanceState;
      })
      .then((next) => {
        setState(next);
      })
      .catch(() => {
        setState(null);
        setFetchError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function acceptCurrentTerms() {
    if (!confirmed) return;
    setAccepting(true);
    try {
      const response = await fetch("/api/v1/legal/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true, context: "settings" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || "Could not save acceptance");
      }
      const refreshed = await fetch("/api/v1/legal/acceptance", {
        cache: "no-store",
      }).then((result) => result.json());
      setState(refreshed.data as AcceptanceState);
      toast.success("Your legal acceptance was recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save acceptance");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <SettingsSectionCard
      title="Policies and account rights"
      description={`Manage current agreements, policy access, and account data portability. Effective ${LEGAL_EFFECTIVE_DATE}.`}
    >
      {/* 1. Agreement Status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="nb-ui-label text-foreground">Terms of Service &amp; EULA</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">
            {fetchError
              ? "Unable to verify current agreement status. Please retry."
              : state?.current
                ? `Bound by Terms of Service (${LEGAL_VERSIONS.terms}) and EULA (${LEGAL_VERSIONS.eula})${
                    state.latest?.acceptedAt
                      ? ` · Recorded ${new Date(state.latest.acceptedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}`
                      : ""
                  }.`
                : `This account has not yet accepted the current terms (${LEGAL_VERSIONS.terms} / ${LEGAL_VERSIONS.eula}).`}
          </p>
        </div>
        <div className="shrink-0">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Checking…
            </span>
          ) : fetchError ? (
            <span className="inline-flex items-center gap-2">
              <span className="rounded-full border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                Check failed
              </span>
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void loadStatus()}>
                Retry
              </Button>
            </span>
          ) : state?.current ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Current &amp; Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              Pending acceptance
            </span>
          )}
        </div>
      </div>

      {!loading && !fetchError && !state?.current && (
        <div className="mt-4 space-y-4 rounded-md border border-border bg-muted/40 p-4">
          <label className="flex cursor-pointer items-start gap-3 nb-compact text-foreground">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
              className="mt-0.5"
            />
            <span>
              I am at least 18 years old, accept the{" "}
              <a href="/terms" target="_blank" className="font-medium text-primary hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/eula" target="_blank" className="font-medium text-primary hover:underline">
                EULA
              </a>
              , and acknowledge the{" "}
              <a href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!confirmed || accepting}
            onClick={() => void acceptCurrentTerms()}
          >
            {accepting ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Scale className="mr-1.5 size-3.5" strokeWidth={1.75} />
            )}
            Accept current terms
          </Button>
        </div>
      )}

      {/* 2. Governing Policies */}
      <div className="my-6 border-t border-border" />

      <div className="mb-3">
        <h4 className="nb-ui-label text-foreground">Governing policies</h4>
        <p className="nb-compact mt-0.5 text-muted-foreground">
          Official agreements, acceptable use policies, and privacy notices governing your use of NetworkBase.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {governingDocuments.map((doc) => (
          <a
            key={doc.href}
            href={doc.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-md border border-border bg-background px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
          >
            <span className="truncate group-hover:text-primary">{doc.title}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          </a>
        ))}
      </div>

      {/* 3. Data Portability */}
      <div className="my-6 border-t border-border" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h4 className="nb-ui-label text-foreground">Export account data</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">
            Download a machine-readable JSON archive containing your profile, tasks, projects, comments, and settings.
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/v1/account/export" download>
              <Download className="mr-1.5 size-3.5" />
              Download JSON
            </a>
          </Button>
        </div>
      </div>
    </SettingsSectionCard>
  );
}
