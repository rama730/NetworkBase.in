"use client";

import { useState, useEffect } from "react";
import * as sync from "@/app/actions/github-sync";
import { Loader2, ShieldCheck, Mail } from "lucide-react";

type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;

export function GitHubCommitAttributionSettings() {
  const [currentIdentity, setCurrentIdentity] = useState<Success<
    Awaited<ReturnType<typeof sync.getCurrentGitHubCommitIdentity>>
  > | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingCurrent(true);
    sync.getCurrentGitHubCommitIdentity()
      .then((res) => {
        if (active && res.success && res.data) {
          setCurrentIdentity(res.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingCurrent(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="nb-ui-label text-foreground">Commit attribution</h4>
          <p className="nb-compact mt-1 text-muted-foreground">
            NetworkBase automatically signs Git commits with your privacy-safe GitHub noreply identity.
          </p>
        </div>
        {currentIdentity?.email ? (
          <span className="nb-meta self-start text-muted-foreground sm:self-center">
            Connected
          </span>
        ) : null}
      </div>

      {/* Active Author Identity Card */}
      {currentIdentity && currentIdentity.email ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-muted/50 px-3 py-3">
          <div className="nb-compact flex items-center gap-1.5 font-medium text-foreground">
            <Mail className="size-4 text-muted-foreground" strokeWidth={1.75} />
            <span>Active commit author:</span>
          </div>
          <code className="nb-meta rounded-md border border-border bg-background px-2 py-1 text-foreground">
            {currentIdentity.email}
          </code>
          {currentIdentity.isNoreply ? (
            <span className="nb-meta inline-flex items-center gap-1 text-muted-foreground">
              <ShieldCheck className="size-3.5" strokeWidth={1.75} />
              Privacy-safe noreply
            </span>
          ) : (
            <span className="nb-meta inline-flex items-center gap-1 text-muted-foreground">
              <ShieldCheck className="size-3.5" strokeWidth={1.75} />
              Verified email
            </span>
          )}
        </div>
      ) : loadingCurrent ? (
        <div className="nb-compact mt-3 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading commit attribution status…</span>
        </div>
      ) : null}
    </div>
  );
}
