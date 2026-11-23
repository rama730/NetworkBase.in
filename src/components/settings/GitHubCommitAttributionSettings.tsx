"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useCallback, useEffect, useState } from "react";
import * as sync from "@/app/actions/github-sync";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";

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

  // Settings mix: one row in Integrations › GitHub; the address in mono on the right.
  const email = currentIdentity?.email ?? null;
  return (
    <SettingsRow
      id="settings-integrations-author"
      title="Commit author"
      description="Commits you make from NetworkBase use a privacy-safe GitHub address. Choose which from each workspace’s contributor settings."
      meta={email ? (currentIdentity?.isNoreply ? "Privacy-safe noreply address" : configured ? "The address you chose" : "From your GitHub sign-in · not confirmed yet") : undefined}
      right={failed ? <ErrorNotice what="Commit author" onRetry={() => void load()} />
        : email ? <span className="v">{email}</span>
        : loadingCurrent ? <span role="status" className="nb-waiting nbs-meta"><PixelBeat />Loading…</span>
        : <span className="v text-muted-foreground">Not set</span>}
    />
  );
}
