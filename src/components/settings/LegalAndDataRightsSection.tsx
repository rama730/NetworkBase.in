"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { LEGAL_PAGE_NAMES } from "@/lib/copy/terms";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, Download, ExternalLink, Scale } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { useOpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";
import { LogList, Tag } from "@/components/settings/mix/parts";
import { legalAcceptanceKey } from "@/components/settings/mix/useSettingsSummary";
import { SavedTick } from "@/components/ui/SavedTick";
import { copyText } from "@/lib/clipboard";
import { logDate } from "@/lib/settings/format";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSIONS } from "@/lib/legal/versions";
import { openCookieSettings } from "@/lib/privacy/cookie-consent";
import { formatCalendarDate } from "@/lib/ui/date-formatting";
import { DownloadLink } from "@/components/ui/download-link";

type AcceptanceHistoryEntry = { acceptedAt: string; termsVersion: string; eulaVersion: string; privacyNoticeVersion: string; context: string };
type AcceptanceState = {
  current: boolean;
  /** The versions in force now, as the server holds them. */
  versions?: { termsVersion: string; eulaVersion: string; privacyNoticeVersion: string };
  history?: AcceptanceHistoryEntry[];
  latest: {
    acceptedAt: string;
    termsVersion: string;
    eulaVersion: string;
    privacyNoticeVersion: string;
  } | null;
};

const governingDocuments = [
  { href: "/terms", title: LEGAL_PAGE_NAMES.terms },
  { href: "/privacy", title: LEGAL_PAGE_NAMES.privacy },
  { href: "/eula", title: LEGAL_PAGE_NAMES.eula },
  { href: "/acceptable-use", title: LEGAL_PAGE_NAMES.acceptableUse },
  { href: "/cookies", title: LEGAL_PAGE_NAMES.cookies },
  { href: "/subprocessors", title: LEGAL_PAGE_NAMES.subprocessors },
  { href: "/dpa", title: LEGAL_PAGE_NAMES.dpa },
  { href: "/copyright", title: LEGAL_PAGE_NAMES.copyright },
  { href: "/open-source", title: "Open-source notices" },
  { href: "/security-reporting", title: LEGAL_PAGE_NAMES.security },
  { href: "/grievances", title: LEGAL_PAGE_NAMES.grievances },
  { href: "/support", title: "Help and support" },
] as const;

// Rights that have no button yet are asked for by email, with the subject filled in.
const RIGHTS_REQUEST_HREF = "mailto:privacy@networkbase.in?subject=Privacy%20rights%20request";

/** `inWorkspace`: shown inside a workspace's or organization's Settings, where Delete account isn't below (student check 13). */
export function LegalAndDataRightsSection({ inWorkspace = false }: { inWorkspace?: boolean } = {}) {
  const open = useOpenSettingsSections();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(0);
  const [state, setState] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);

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
    fetch("/api/v1/account/export-status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setLastExportedAt(typeof payload?.data?.lastExportedAt === "string" ? payload.data.lastExportedAt : null))
      .catch(() => undefined);
  }, [loadStatus]);

  async function acceptCurrentTerms() {
    if (!confirmed || !ageConfirmed) return;
    setAccepting(true);
    try {
      const response = await fetch("/api/v1/legal/acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true, context: "settings", ageConfirmed }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "Couldn’t save acceptance");
      }
      // Said only once the new state is actually in hand: a failed re-read must not read as "pending" after success.
      toast.success("Your legal acceptance was recorded");
      loadStatus();
      void queryClient.invalidateQueries({ queryKey: legalAcceptanceKey() });
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t save acceptance", "Couldn’t save acceptance"));
    } finally {
      setAccepting(false);
    }
  }

  const agreementText = fetchError
    ? "Couldn’t check your agreement status."
    : state?.current
      ? `You accepted the Terms (${state.latest?.termsVersion ?? LEGAL_VERSIONS.terms}) and the EULA (${state.latest?.eulaVersion ?? LEGAL_VERSIONS.eula}), and acknowledged the Privacy Policy (${state.latest?.privacyNoticeVersion ?? LEGAL_VERSIONS.privacy})${state.latest?.acceptedAt ? `, on ${formatCalendarDate(state.latest.acceptedAt)}` : ""}.`
      : `The terms changed: Terms ${state?.versions?.termsVersion ?? LEGAL_VERSIONS.terms}, EULA ${state?.versions?.eulaVersion ?? LEGAL_VERSIONS.eula}, Privacy Policy ${state?.versions?.privacyNoticeVersion ?? LEGAL_VERSIONS.privacy}.`;
  const acceptForm = !loading && !fetchError && !state?.current ? (
    <div className="nbs-inline-form">
      <label className="flex cursor-pointer items-start gap-3 text-[13px] text-foreground">
        <Checkbox checked={ageConfirmed} onCheckedChange={(value) => setAgeConfirmed(value === true)} className="mt-0.5" />
        <span>I am at least 18 years old.</span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-[13px] text-foreground">
        <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-0.5" />
        <span>I accept the <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">Terms of Service</a> and <a href="/eula" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">EULA</a>, and acknowledge the <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">Privacy Policy</a>.</span>
      </label>
      <div><Button pending={accepting} type="button" size="sm" disabled={!confirmed || !ageConfirmed || accepting} onClick={() => void acceptCurrentTerms()}>Accept current terms</Button></div>
    </div>
  ) : null;

  // Settings mix (the Settings page): agreements, a policy grid and your data as rows. Workspace settings keep the card.
  if (open) {
    return (
      <>
        <SettingsSectionCard id="settings-privacy-policies-terms" title="Agreements" state={!loading && !fetchError && state && !state.current ? "accept" : undefined} flush findKeys="terms eula accept">
          <SettingsRows>
            <SettingsRow title="Terms of Service and EULA" description={agreementText}
              right={loading ? <span role="status" className="nb-waiting nbs-meta"><PixelBeat />Checking…</span>
                : fetchError ? <span role="alert" className="nb-retry"><b>Couldn’t check</b><button type="button" onClick={() => void loadStatus()}>Try again</button></span>
                : state?.current ? <Tag tone="ok" tick>Accepted</Tag> : <Tag tone="warn">To accept</Tag>}>
              {acceptForm}
            </SettingsRow>
          </SettingsRows>
          {state?.history && state.history.length > 1 ? (
            <LogList label="Earlier agreements" entries={state.history.map((entry) => ({ key: `${entry.acceptedAt}-${entry.termsVersion}`, date: logDate(entry.acceptedAt), dateTime: entry.acceptedAt, event: "Accepted", detail: `Terms ${entry.termsVersion} · EULA ${entry.eulaVersion} · Privacy ${entry.privacyNoticeVersion}` }))} />
          ) : null}
        </SettingsSectionCard>

        <SettingsSectionCard id="settings-privacy-policies-list" title="Policies" description={`In force since ${LEGAL_EFFECTIVE_DATE}.`} flush findKeys="policy terms privacy cookies dpa copyright">
          <div className="nbs-policies">
            {governingDocuments.map((doc) => <Link key={doc.href} href={doc.href} target="_blank" rel="noopener noreferrer">{doc.title}<span aria-hidden="true">↗</span></Link>)}
          </div>
        </SettingsSectionCard>

        <SettingsSectionCard id="settings-privacy-policies-data" title="Your data" flush findKeys="export download gdpr cookies rights">
          <SettingsRows>
            <SettingsRow id="settings-privacy-policies-export" title="Export your data"
              description="One JSON file: your profile, contributions, workspaces, tasks, the comments and messages you wrote, your connections and your agreements."
              meta={`Last export: ${lastExportedAt ? formatCalendarDate(lastExportedAt) : "never"} · once an hour`}
              right={<Button variant="outline" size="sm" asChild><DownloadLink href="/api/v1/account/export"><Download className="size-3.5" aria-hidden="true" />Export</DownloadLink></Button>} />
            <SettingsRow id="settings-privacy-policies-cookies" title="Cookie preferences" description="Which optional cookies and local storage NetworkBase may use."
              right={<Button type="button" variant="outline" size="sm" onClick={openCookieSettings}>Manage</Button>} />
            <SettingsRow id="settings-privacy-policies-requests" title="Other requests"
              description={<>To correct, restrict or object to how your data is used, write to <span className="select-all font-mono">privacy@networkbase.in</span>.</>}
              right={<>{copied ? <SavedTick key={copied} label="Copied" /> : null}<Button type="button" variant="ghost" size="sm" onClick={() => { copyText("privacy@networkbase.in").then(() => setCopied((n) => n + 1), () => undefined); }}><Copy className="size-3.5" aria-hidden="true" />Copy address</Button></>} />
          </SettingsRows>
        </SettingsSectionCard>
      </>
    );
  }

  return (
    <SettingsSectionCard
      title="Legal and data rights"
      description={`Manage current agreements, policy access, and account data portability. Effective ${LEGAL_EFFECTIVE_DATE}.`}
    >
      {/* 1. Agreement Status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="nb-ui-label text-foreground">Terms of Service and EULA</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">
            {fetchError
              ? "Couldn’t verify current agreement status. Retry."
              : state?.current
                ? `You accepted Terms of Service (${state.latest?.termsVersion ?? LEGAL_VERSIONS.terms}), the EULA (${state.latest?.eulaVersion ?? LEGAL_VERSIONS.eula}) and acknowledged the Privacy Policy (${state.latest?.privacyNoticeVersion ?? LEGAL_VERSIONS.privacy})${
                    state.latest?.acceptedAt ? ` on ${formatCalendarDate(state.latest.acceptedAt)}` : ""
                  }.`
                : `This account has not yet accepted the current terms (Terms ${state?.versions?.termsVersion ?? LEGAL_VERSIONS.terms}, EULA ${state?.versions?.eulaVersion ?? LEGAL_VERSIONS.eula}, Privacy Policy ${state?.versions?.privacyNoticeVersion ?? LEGAL_VERSIONS.privacy}).`}
          </p>
        </div>
        <div className="shrink-0">
          {loading ? (
            <span role="status" className="inline-flex items-center gap-1.5 nb-meta text-muted-foreground">
              <PixelBeat /> Checking…
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
              Accepted
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
            <Checkbox checked={ageConfirmed} onCheckedChange={(value) => setAgeConfirmed(value === true)} className="mt-0.5" />
            <span>I am at least 18 years old.</span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 nb-compact text-foreground">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
              className="mt-0.5"
            />
            <span>
              I accept the{" "}
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
          <Button pending={accepting}
            type="button"
            size="sm"
            disabled={!confirmed || !ageConfirmed || accepting}
            onClick={() => void acceptCurrentTerms()}
          >
            <Scale className="mr-1.5 size-3.5" strokeWidth={1.75} />
            Accept current terms
          </Button>
        </div>
      )}

      {state?.history && state.history.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer nb-compact font-medium text-foreground">Acceptance history ({state.history.length})</summary>
          <ul className="mt-2 divide-y divide-border">
            {state.history.map((entry) => (
              <li key={`${entry.acceptedAt}-${entry.termsVersion}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="nb-compact text-foreground">Terms {entry.termsVersion} · EULA {entry.eulaVersion} · Privacy {entry.privacyNoticeVersion}</span>
                <time dateTime={entry.acceptedAt} className="nb-meta text-muted-foreground">{formatCalendarDate(entry.acceptedAt)}</time>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* 2. Governing Policies */}
      <div className="my-6 border-t border-border" />

      <div className="mb-3">
        <h4 className="nb-ui-label text-foreground">Policies</h4>
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
          <h4 className="nb-ui-label text-foreground">Export your data</h4>
          <p className="nb-compact mt-0.5 text-muted-foreground">
            Download a JSON file with your profile, workspace contributions, the workspaces you own and are a member of, tasks assigned to you, your comments on workspace updates, your connections, the messages you wrote, and your legal acceptances. You can export once an hour.{lastExportedAt ? ` Last exported ${formatCalendarDate(lastExportedAt)}.` : ""}
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="outline" size="sm" asChild>
            <DownloadLink href="/api/v1/account/export">
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              Export your data
            </DownloadLink>
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
          <p className="nb-compact mt-0.5 text-muted-foreground">To correct or restrict how your data is used, or to object, write to us at privacy@networkbase.in. {inWorkspace ? <>Export is above; to delete your account, go to <Link href="/settings#settings-delete-account" className="underline underline-offset-2">your account settings</Link>.</> : "Deletion and export are above and in Delete account below."}</p>
        </div>
        <Button variant="outline" size="sm" asChild><a href={RIGHTS_REQUEST_HREF}>Email a request</a></Button>
      </div>
    </SettingsSectionCard>
  );
}
