"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, Loader2, Scale } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSIONS } from "@/lib/legal/versions";
import { openCookieSettings } from "@/lib/privacy/cookie-consent";
import { formatCalendarDate } from "@/lib/ui/date-formatting";

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
  { href: "/eula", title: "End User License Agreement" },
  { href: "/acceptable-use", title: "Acceptable Use Policy" },
  { href: "/cookies", title: "Cookies & Local Storage" },
  { href: "/subprocessors", title: "Service Providers" },
  { href: "/dpa", title: "Data Processing Agreement" },
  { href: "/copyright", title: "Copyright & Takedowns" },
  { href: "/open-source", title: "Open-source notices" },
  { href: "/security-reporting", title: "Security Reporting" },
  { href: "/grievances", title: "Grievances & Redressal" },
  { href: "/support", title: "Support" },
] as const;

// Rights that have no button yet are asked for by email, with the subject filled in.
const RIGHTS_REQUEST_HREF = "mailto:privacy@networkbase.in?subject=Privacy%20rights%20request";

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
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success === false || !payload?.data) {
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
        throw new Error(payload?.message || "Could not save acceptance");
      }
      // Said only once the new state is actually in hand: a failed re-read must not read as "pending" after success.
      toast.success("Your legal acceptance was recorded");
      loadStatus();
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Could not save acceptance", "Could not save acceptance"));
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
                ? `You accepted Terms of Service (${state.latest?.termsVersion ?? LEGAL_VERSIONS.terms}), the EULA (${state.latest?.eulaVersion ?? LEGAL_VERSIONS.eula}) and acknowledged the Privacy Policy (${state.latest?.privacyNoticeVersion ?? LEGAL_VERSIONS.privacy})${
                    state.latest?.acceptedAt ? ` on ${formatCalendarDate(state.latest.acceptedAt)}` : ""
                  }.`
                : `This account has not yet accepted the current terms (${LEGAL_VERSIONS.terms} / ${LEGAL_VERSIONS.eula}).`}
          </p>
        </div>
        <div className="shrink-0">
          {loading ? (
            <span role="status" className="inline-flex items-center gap-1.5 nb-meta text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Checking…
            </span>
          ) : fetchError ? (
            <span role="alert" className="inline-flex items-center gap-2">
              <span className="rounded-full border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] px-2.5 py-1 nb-meta font-medium text-[var(--status-danger)]">
                Check failed
              </span>
              <Button type="button" variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => void loadStatus()}>
                Retry
              </Button>
            </span>
          ) : state?.current ? (
            <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-success)]/30 bg-[var(--status-success-soft)] px-2.5 py-1 nb-meta font-medium text-[var(--status-success)]">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Current &amp; Active
            </span>
          ) : (
            <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-2.5 py-1 nb-meta font-medium text-[var(--status-warning)]">
              Pending acceptance
            </span>
          )}
        </div>
      </div>

      {!loading && !fetchError && !state?.current && (
        <div className="mt-4 space-y-4 rounded-md border border-border bg-muted/40 p-4">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 nb-compact text-foreground">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
              className="mt-0.5"
            />
            <span>
              I am at least 18 years old, accept the{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/eula" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                EULA
              </a>
              , and acknowledge the{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
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
          <Link
            key={doc.href}
            href={doc.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-h-11 items-center justify-between rounded-md border border-border bg-background px-3.5 py-2.5 nb-compact font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
          >
            <span className="truncate group-hover:text-primary">{doc.title}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
          </Link>
        ))}
      </div>

      {/* 3. Data Portability */}
      <div className="my-6 border-t border-border" />

      <div id="settings-privacy-policies-export" className="flex scroll-mt-6 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h4 className="nb-ui-label text-foreground">Export account data</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">
            Download a JSON file with your profile, project contributions, the projects you own, your connections, the messages you wrote, and your legal acceptances. You can export once an hour.
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/v1/account/export" download>
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              Download JSON
            </a>
          </Button>
        </div>
      </div>

      {/* 4. Choices and requests */}
      <div className="my-6 border-t border-border" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h4 className="nb-ui-label text-foreground">Cookie preferences</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">Review or change which optional cookies and local storage NetworkBase may use.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openCookieSettings}>Manage cookie preferences</Button>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h4 className="nb-ui-label text-foreground">Other rights requests</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">To correct or restrict how your data is used, or to object, write to us at privacy@networkbase.in. Deletion and export are above and in Delete account below.</p>
        </div>
        <Button variant="outline" size="sm" asChild><a href={RIGHTS_REQUEST_HREF}>Email a request</a></Button>
      </div>
    </SettingsSectionCard>
  );
}
