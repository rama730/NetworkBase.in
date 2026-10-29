"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, Mail } from "lucide-react";
import * as sync from "@/app/actions/github-sync";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;

type Identity = Success<Awaited<ReturnType<typeof sync.getCurrentGitHubCommitIdentity>>>;

export function GitHubCommitAttributionSettings() {
  const [currentIdentity, setCurrentIdentity] = useState<Identity | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setLoadingCurrent(true);
    setFailed(false);
    sync.getCurrentGitHubCommitIdentity()
      .then((res) => {
        if (!active) return;
        if (res.success) setCurrentIdentity(res.data ?? null);
        else setFailed(true);
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoadingCurrent(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => load(), [load]);

  // `configured` is true once the person has picked a commit identity; before that the address is only the one
  // GitHub gave us at sign-in, so it is not called verified.
  const configured = Boolean(currentIdentity && "configured" in currentIdentity && currentIdentity.configured);

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="nb-ui-label text-foreground">Commit author</h4>
          <p className="nb-compact mt-1 text-muted-foreground">
            Commits made from NetworkBase are signed with a privacy-safe GitHub address. You can choose which address from each workspace’s contributor settings.
          </p>
        </div>
        {currentIdentity?.email ? (
          <span className="nb-meta self-start text-muted-foreground sm:self-center">
            {configured ? "Chosen" : "From your GitHub sign-in"}
          </span>
        ) : null}
      </div>

      {failed ? (
        <ErrorNotice what="Commit author" onRetry={() => void load()} className="mt-3" />
      ) : currentIdentity && currentIdentity.email ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-muted/50 px-3 py-3">
          <div className="nb-compact flex items-center gap-1.5 font-medium text-foreground">
            <Mail className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <span>Commit author:</span>
          </div>
          <code className="nb-meta rounded-md border border-border bg-background px-2 py-1 text-foreground">
            {currentIdentity.email}
          </code>
          <span className="nb-meta inline-flex items-center gap-1 text-muted-foreground">
            <ShieldCheck className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {currentIdentity.isNoreply ? "Privacy-safe noreply address" : configured ? "Email you chose" : "Not confirmed yet: choose one in a workspace"}
          </span>
        </div>
      ) : loadingCurrent ? (
        <div role="status" className="nb-compact mt-3 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>Loading commit attribution status…</span>
        </div>
      ) : null}
    </div>
  );
}
