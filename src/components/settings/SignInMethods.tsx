"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Tag } from "@/components/settings/mix/parts";
import { jumpToSetting } from "@/components/settings/mix/jump";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { useIntegrationsData } from "@/hooks/useSettingsQueries";
import { startGithubIdentityLink, startGoogleIdentityLink } from "@/lib/github/oauth-client";
import { feedbackError, toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import type { AuthConnectionMethod } from "@/types/settingsTypes";

type Provider = "google" | "github";
const TILE: Record<string, string> = { email: "@", google: "G", github: "GH" };
const NAME: Record<Provider, string> = { google: "Google", github: "GitHub" };

/**
 * The ways to sign in other than the password (settings mix v2: sign-in lives in one place, Security › How you sign in):
 * the email link, Google and GitHub, each linked or unlinked here. Unlinking asks first, then verifies it's you.
 */
export function SignInMethods() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useIntegrationsData();
  const [linking, setLinking] = useState<Provider | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<Provider | null>(null);
  const unlinkPending = useRef<Provider | null>(null);
  const [stepUp, setStepUp] = useState<{ methods: Array<"totp" | "recovery_code" | "password">; factorId?: string } | null>(null);

  // Back from Google or GitHub: say how it went, clean the address, and land on this list (or on GitHub in Integrations
  // after replacing an unavailable GitHub account).
  useEffect(() => {
    const google = searchParams.get("identityProvider") === "google";
    const outcome = searchParams.get("githubIdentity") ?? (google ? "linked" : null);
    if (!outcome) return;
    const label = google ? "Google" : "GitHub";
    if (outcome === "replaced") toast.success("GitHub account replaced");
    else if (outcome === "linked") toast.success(`${label} account linked`);
    else if (outcome === "already_linked") toast.info(`This ${label} account is already linked`);
    else if (outcome === "error") toast.error(feedbackError(searchParams.get("githubErrorDesc") || `Couldn’t link ${label} account. Try again.`, `Couldn’t link ${label} account. Try again.`));
    const next = new URLSearchParams(searchParams.toString());
    ["identityProvider", "githubIdentity", "githubErrorDesc", "tab"].forEach((key) => next.delete(key));
    const query = next.toString();
    router.replace(`/settings${query ? `?${query}` : ""}#${outcome === "replaced" ? "settings-integrations-github" : "settings-security-signin"}`, { scroll: false });
    void refetch();
  }, [refetch, router, searchParams]);

  const link = async (provider: Provider) => {
    setLinking(provider);
    try {
      if (provider === "github") await startGithubIdentityLink({ nextPath: "/settings?githubIdentity=linked" });
      else await startGoogleIdentityLink();
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : `Couldn’t link ${NAME[provider]}`, "Action couldn’t finish"));
      setLinking(null);
    }
  };

  const askWhoYouAre = async () => {
    try {
      const response = await fetch("/api/v1/auth/security-step-up");
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.message || "Couldn’t load verification options");
      const methods = (Array.isArray(payload?.data?.availableMethods) ? payload.data.availableMethods : []).filter((method: unknown): method is "totp" | "recovery_code" | "password" => method === "totp" || method === "recovery_code" || method === "password");
      if (!methods.length) { toast.warning("Add a password or authenticator first, then disconnect a sign-in method"); return; }
      setStepUp({ methods, factorId: typeof payload?.data?.primaryTotpFactorId === "string" ? payload.data.primaryTotpFactorId : undefined });
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t start verification", "Couldn’t start verification"));
    }
  };

  const unlink = async (provider: Provider) => {
    unlinkPending.current = provider;
    const response = await fetch("/api/v1/integrations/unlink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
    const payload = await response.json().catch(() => null);
    if (response.status === 403 && payload?.errorCode === "STEP_UP_REQUIRED") { await askWhoYouAre(); return; }
    if (!response.ok || payload?.success === false) { toast.warning(payload?.message || "That sign-in method could not be disconnected"); return; }
    unlinkPending.current = null;
    toast.success(`${NAME[provider]} unlinked`);
    void refetch();
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  };

  const methods: AuthConnectionMethod[] = data?.authConnections ?? [];
  const order = ["email", "google", "github"];
  const rows = [...methods].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));

  if (isLoading && !rows.length) return <div className="nbs-li" aria-hidden="true"><span className="tile" /><div className="nb-skeleton h-8 rounded" /><span /></div>;

  return (
    <>
      {rows.map((method) => {
        const linked = method.state !== "not_linked";
        if (method.provider === "email") {
          return <SecurityListRow key="email" id="settings-security-email-signin" tile={<span className="tile" aria-hidden="true">{TILE.email}</span>} title="Email link"
            badges={method.state === "primary" ? <Tag>Main</Tag> : null}
            details={method.detail}
            action={!linked ? <Button type="button" variant="outline" size="sm" onClick={() => jumpToSetting("settings-security-password")}>Set a password</Button> : null} />;
        }
        const provider = method.provider as Provider;
        return <SecurityListRow key={provider} id={`settings-security-${provider}`} tile={<span className="tile" aria-hidden="true">{TILE[provider]}</span>} title={method.label}
          badges={linked ? <Tag tone="ok" tick>{method.state === "primary" ? "Main" : "Linked"}</Tag> : null}
          details={linked ? [method.detail, method.secondaryDetail].filter(Boolean).join(" · ") : provider === "github" ? "Sign in with GitHub. Linking also lets you import and sync repositories; access is set per workspace in Integrations." : "Sign in with your Google account."}
          action={linked
            ? <Button type="button" variant="ghost" size="sm" onClick={() => setUnlinkConfirm(provider)}>Unlink</Button>
            : <Button type="button" variant="outline" size="sm" pending={linking === provider} disabled={linking !== null} onClick={() => void link(provider)}>Link</Button>} />;
      })}

      <ConfirmDialog
        open={unlinkConfirm !== null}
        onOpenChange={(open) => { if (!open) setUnlinkConfirm(null); }}
        title={`Unlink ${unlinkConfirm ? NAME[unlinkConfirm] : ""}?`}
        description={unlinkConfirm === "github" ? "You can no longer sign in with GitHub, and repository access from this account stops. Your workspaces stay as they are." : "You can no longer sign in with Google. You need another way to sign in first."}
        confirmLabel="Unlink"
        variant="destructive"
        onConfirm={() => (unlinkConfirm ? unlink(unlinkConfirm) : undefined)}
      />
      <SecurityStepUpDialog
        open={stepUp !== null}
        onOpenChange={(open) => { if (!open) setStepUp(null); }}
        title="Verify before unlinking"
        description="Removing a way to sign in is a security change, so confirm it is you first."
        availableMethods={stepUp?.methods ?? []}
        factorId={stepUp?.factorId}
        onVerified={async () => { if (unlinkPending.current) await unlink(unlinkPending.current); }}
      />
    </>
  );
}
