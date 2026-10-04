"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Database, ExternalLink, FileText, Loader2, Scale, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSIONS } from "@/lib/legal/versions";

 type AcceptanceState = {
  current: boolean;
  latest: { acceptedAt: string; termsVersion: string; eulaVersion: string; privacyNoticeVersion: string } | null;
};

const documents = [
  { href: "/privacy", title: "Privacy Policy", description: "Data use, retention, sharing, and your rights." },
  { href: "/terms", title: "Terms of Service", description: "Rules for accounts, projects, content, and collaboration." },
  { href: "/eula", title: "End User Licence Agreement", description: "Licence terms for the application and related software." },
  { href: "/acceptable-use", title: "Acceptable Use Policy", description: "Prohibited conduct, enforcement, and abuse reports." },
  { href: "/cookies", title: "Cookies & Local Storage", description: "Required authentication and optional analytics storage." },
  { href: "/subprocessors", title: "Service Providers", description: "Providers that process data to operate NetworkBase." },
] as const;

const dataRights = [
  { href: "/settings?tab=privacy-policies#settings-delete-account", title: "Export or delete", description: "Download account data or begin deletion.", icon: Database },
  { href: "/settings?tab=integrations", title: "Connected services", description: "Review and disconnect external services.", icon: FileText },
  { href: "/settings?tab=security", title: "Account security", description: "Review sessions and security activity.", icon: ShieldCheck },
] as const;

function SubsectionHeading({ title, description }: { title: string; description: string }) {
  return <div><h4 className="nb-ui-label text-foreground">{title}</h4><p className="nb-compact mt-1 text-muted-foreground">{description}</p></div>;
}

export function LegalAndDataRightsSection() {
  const [state, setState] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/legal/acceptance", { cache: "no-store" })
      .then(async (response) => { const payload = await response.json(); if (!response.ok || payload?.success === false) throw new Error("Acceptance status unavailable"); return payload.data as AcceptanceState; })
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setState(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function acceptCurrentTerms() {
    if (!confirmed) return;
    setAccepting(true);
    try {
      const response = await fetch("/api/v1/legal/acceptance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: true, context: "settings" }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || "Could not save acceptance");
      const refreshed = await fetch("/api/v1/legal/acceptance", { cache: "no-store" }).then((result) => result.json());
      setState(refreshed.data as AcceptanceState);
      toast.success("Your legal acceptance was recorded");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save acceptance"); } finally { setAccepting(false); }
  }

  return <SettingsSectionCard title="Policies and account rights" description={`Review current documents, acceptance, and account data controls. Effective ${LEGAL_EFFECTIVE_DATE}.`}>
    <SubsectionHeading title="Legal documents" description="The current policies that govern your account and use of NetworkBase." />
    <div className="mt-3 grid gap-x-6 md:grid-cols-2">
      {documents.map((document) => <a key={document.href} href={document.href} target="_blank" className="group flex min-h-16 items-center justify-between gap-3 border-b border-border py-3 last:border-b-0 md:[&:nth-last-child(-n+2)]:border-b-0"><span><span className="block nb-ui-label text-foreground group-hover:text-primary">{document.title}</span><span className="block nb-compact mt-1 text-muted-foreground">{document.description}</span></span><ExternalLink className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" strokeWidth={1.75} /></a>)}
    </div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 nb-compact font-medium"><a className="text-primary hover:underline" href="/copyright" target="_blank">Copyright & IP</a><a className="text-primary hover:underline" href="/privacy#changes" target="_blank">Privacy contact</a><a className="text-primary hover:underline" href="/grievances" target="_blank">Grievance contact</a></div>

    <div className="my-6 border-t border-border" />
    <SubsectionHeading title="Terms acceptance" description="Identify the terms currently associated with this account." />
    {loading ? <p className="mt-3 flex items-center gap-2 nb-compact text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking your status…</p> : state?.current ? <div className="mt-3 flex min-h-16 items-start gap-3 rounded-md border border-border bg-muted/50 p-4"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.75} /><div><p className="nb-ui-label text-foreground">Current Terms and EULA accepted</p><p className="nb-compact mt-1 text-muted-foreground">Recorded {state.latest?.acceptedAt ? new Date(state.latest.acceptedAt).toLocaleString() : "for this account"}. Privacy Policy acknowledgement is recorded as notice.</p></div></div> : <div className="mt-3 space-y-4 rounded-md border border-border bg-muted/50 p-4"><p className="nb-compact text-foreground">This account has not accepted the current Terms of Service ({LEGAL_VERSIONS.terms}) and EULA ({LEGAL_VERSIONS.eula}).</p><label className="flex cursor-pointer items-start gap-3 nb-compact text-foreground"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-0.5" /><span>I am at least 18 years old, accept the <a href="/terms" target="_blank" className="font-medium text-primary hover:underline">Terms of Service</a> and <a href="/eula" target="_blank" className="font-medium text-primary hover:underline">EULA</a>, and acknowledge the <a href="/privacy" target="_blank" className="font-medium text-primary hover:underline">Privacy Policy</a>.</span></label><Button type="button" disabled={!confirmed || accepting} onClick={() => void acceptCurrentTerms()}>{accepting ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" strokeWidth={1.75} />}Accept current terms</Button></div>}

    <div className="my-6 border-t border-border" />
    <SubsectionHeading title="Your data rights" description="Open the controls for access, portability, deletion, and connected services." />
    <div className="mt-3 divide-y divide-border">
      {dataRights.map(({ href, title, description, icon: Icon }) => <Link key={href} href={href} className="group flex min-h-16 items-center gap-3 py-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary"><Icon className="size-4" strokeWidth={1.75} /></span><span><span className="block nb-ui-label text-foreground group-hover:text-primary">{title}</span><span className="block nb-compact mt-1 text-muted-foreground">{description}</span></span></Link>)}
    </div>
  </SettingsSectionCard>;
}
