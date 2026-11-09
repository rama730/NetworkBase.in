"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "@/lib/utils/date";
import { ChevronDown, Code2, Copy, ExternalLink, GitBranch, Github, KeyRound, Link2, Loader2, Mail, Terminal } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useExtensionSessionsData, useIntegrationsData } from "@/hooks/useSettingsQueries";
import { startGithubIdentityLink, startGoogleIdentityLink } from "@/lib/github/oauth-client";
import { GitHubCommitAttributionSettings } from "@/components/settings/GitHubCommitAttributionSettings";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { revokeExtensionSession, generateExtensionToken, getActiveExtensionSessions } from "@/app/actions/extension-sessions";
import {
  listPersonalAccessTokens,
  createPersonalAccessToken,
  revokePersonalAccessToken,
  type PersonalAccessTokenSummary,
} from "@/app/actions/personal-access-tokens";
import type { AuthConnectionMethod, ExtensionSessionData, ExtensionSessionsData, IntegrationsAuthProvider } from "@/types/settingsTypes";
import { copyText } from "@/lib/clipboard";

const PROVIDER_ICONS: Partial<Record<IntegrationsAuthProvider, string>> = {
  google: "/skill-icons/v1/logos-google-icon.svg",
  github: "/skill-icons/v1/github.svg",
};

function ProviderIcon({ provider }: { provider: IntegrationsAuthProvider }) {
  const src = PROVIDER_ICONS[provider];
  return src
    ? <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Image src={src} alt="" width={24} height={24} unoptimized className="size-6 object-contain" /></span>
    : <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Mail className="size-4" strokeWidth={1.75} /></span>;
}

function ProviderRow({ provider, linking, onLink, onUnlink }: { provider: AuthConnectionMethod; linking: boolean; onLink: () => void; onUnlink: () => void }) {
  const stateLabel = provider.state === "primary" ? "Main sign-in method" : provider.state === "linked" ? "Connected" : provider.state === "not_linked" ? "Not connected" : String(provider.state).split("_").join(" ");
  return <div className="flex min-h-16 flex-col justify-center gap-3 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-center gap-3">
      <ProviderIcon provider={provider.provider} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h4 className="nb-ui-label text-foreground">{provider.label}</h4><span className="nb-meta text-muted-foreground">{stateLabel}</span></div>
        <p className="nb-compact mt-1 text-muted-foreground">{provider.detail}</p>
        {provider.secondaryDetail ? <p className="nb-meta mt-1 text-muted-foreground">{provider.secondaryDetail}</p> : null}
        {provider.provider === "github" && provider.state === "not_linked" ? <p className="nb-meta mt-1 text-muted-foreground">Connecting asks GitHub to let NetworkBase read your repositories and organizations, and your email, so you can import and sync workspaces.</p> : null}
      </div>
    </div>
    {provider.state === "not_linked" && provider.provider !== "email" ? <Button className="self-start sm:self-auto" size="sm" variant="outline" onClick={onLink} disabled={linking}>{linking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Connect</Button> : null}
    {provider.state !== "not_linked" && (provider.provider === "google" || provider.provider === "github") ? <Button className="self-start sm:self-auto pointer-coarse:h-11" size="sm" variant="outline" onClick={onUnlink}>Disconnect</Button> : null}
    {provider.state === "not_linked" && provider.provider === "email" ? <Button size="sm" variant="outline" asChild><Link href="/settings#settings-security">Set a password</Link></Button> : null}
  </div>;
}

const IDE_ICON_ASSETS: Record<string, string> = {
  vscode: "/ide-icons/vscode.png",
  cursor: "/ide-icons/cursor.png",
  windsurf: "/ide-icons/windsurf.svg",
  antigravity: "/ide-icons/antigravity.png",
};

function resolveIDEIcon(session: ExtensionSessionData) {
  const name = (session.editorName || session.deviceName || "").toLowerCase();
  if (name.includes("cursor")) return IDE_ICON_ASSETS.cursor;
  if (name.includes("windsurf")) return IDE_ICON_ASSETS.windsurf;
  if (name.includes("antigravity")) return IDE_ICON_ASSETS.antigravity;
  if (name.includes("code") || name.includes("vscode")) return IDE_ICON_ASSETS.vscode;
  return null;
}

function formatPlatform(platform: string) {
  const p = platform.toLowerCase();
  if (p === "darwin" || p === "mac" || p === "macos") return "macOS";
  if (p === "win32" || p === "windows" || p === "win") return "Windows";
  if (p === "linux") return "Linux";
  return platform;
}

function ExtensionAppCard() {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Image
          src="/icon-paper-192.png"
          alt=""
          width={48}
          height={48}
          className="size-10 shrink-0 rounded-md object-cover"
        />
        <div className="min-w-0">
          <h4 className="nb-ui-label text-foreground">NetworkBase editor extension & CLI</h4>
          <p className="nb-compact mt-1 text-muted-foreground">
            Open workspace work in your editor or run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">npx @networkbase/cli init</code> in your terminal.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5 font-mono text-xs"
        onClick={() => {
          copyText("npx @networkbase/cli init").then(
            () => toast.success("Copied CLI setup command"),
            () => toast.warning("Couldn’t copy command"),
          );
        }}
      >
        <Terminal className="size-3.5" strokeWidth={1.75} />
        npx @networkbase/cli init
        <Copy className="size-3 text-muted-foreground" strokeWidth={1.75} />
      </Button>
    </div>
  );
}


function ExtensionSessionRow({ session, revoking, onRevoke }: { session: ExtensionSessionData; revoking: boolean; onRevoke: () => void }) {
  const isPending = session.clientVersion === "pending" || (!session.editorPlatform && !session.editorName);
  const isCliSession =
    !isPending &&
    (session.editorHost?.toLowerCase() === "cli" ||
      (session.editorName || session.deviceName || "").toLowerCase().includes("cli"));
  const ideIcon = !isPending && !isCliSession ? resolveIDEIcon(session) : null;
  const platform = isPending
    ? null
    : session.editorPlatform
      ? formatPlatform(session.editorPlatform)
      : "Connected";
  const title = isPending
    ? session.deviceName?.trim() || "Access token"
    : session.editorName?.trim() || session.deviceName?.trim() || (isCliSession ? "NetworkBase CLI" : "Editor extension");

  return (
    <div className="flex min-h-16 flex-col justify-center gap-3 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {ideIcon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Image src={ideIcon} alt="" width={24} height={24} unoptimized className="size-6 object-contain" /></span>
        ) : isCliSession ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Terminal className="size-4" strokeWidth={1.75} />
          </span>
        ) : isPending ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <KeyRound className="size-4" strokeWidth={1.75} />
          </span>
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Code2 className="size-4" strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate nb-ui-label text-foreground" title={title}>{title}</p>
            {isCliSession ? (
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                CLI
              </span>
            ) : null}
            {isPending ? (
              <span className="nb-meta text-muted-foreground">
                Awaiting connection
              </span>
            ) : platform ? (
              <span className="nb-meta text-muted-foreground">
                {platform}
              </span>
            ) : null}
          </div>
          {isPending ? (
            <>
              <p className="nb-compact mt-1 truncate text-muted-foreground">
                Created {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })} · Awaiting initial connection from your editor or CLI
              </p>
              <p className="nb-meta mt-1 truncate text-muted-foreground">
                Access token · Paste it into your editor or run <code className="font-mono">nb auth login --token</code>
              </p>
            </>
          ) : (
            <>
              <p className="nb-compact mt-1 truncate text-muted-foreground">
                Active {formatDistanceToNow(new Date(session.lastSeenAt), { addSuffix: true })} · v{session.clientVersion || "unknown"}
              </p>
              <p className="nb-meta mt-1 truncate text-muted-foreground">
                {isCliSession ? "Signed in from NetworkBase CLI" : session.authMethod === "web_login" ? "Signed in from the editor" : "Access token"}
                {session.editorVersion ? ` · ${session.editorVersion}` : ""}
              </p>
            </>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRevoke}
        disabled={revoking}
        className="self-start sm:self-auto"
      >
        {revoking ? <Loader2 className="size-4 animate-spin" /> : null}
        {revoking ? "Revoking…" : isPending ? "Revoke token" : "Disconnect"}
      </Button>
    </div>
  );
}

export default function IntegrationsSettings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useIntegrationsData();
  const { data: sessionData, isLoading: sessionsLoading, isError: sessionsFailed, refetch: refetchSessions } = useExtensionSessionsData();
  // Sessions past the first page, loaded on request; dropped whenever the first page is read again.
  const [more, setMore] = useState<{ base: unknown; sessions: ExtensionSessionData[]; cursor: string | null; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [linking, setLinking] = useState<IntegrationsAuthProvider | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showTokenGen, setShowTokenGen] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [replacementConfirmOpen, setReplacementConfirmOpen] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // What the verification is for: replacing the GitHub account, or creating a manual token.
  const [stepUpPurpose, setStepUpPurpose] = useState<"replace" | "token" | "unlink">("replace");
  const [unlinkConfirm, setUnlinkConfirm] = useState<"google" | "github" | null>(null);
  // Remembered across the verification dialog, which opens after the confirmation has closed.
  const unlinkPending = useRef<"google" | "github" | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ExtensionSessionData | null>(null);
  const [replacementMethods, setReplacementMethods] = useState<Array<"totp" | "recovery_code" | "password">>([]);
  const [replacementFactorId, setReplacementFactorId] = useState<string | undefined>();
  const [replacingGithub, setReplacingGithub] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [patTokens, setPatTokens] = useState<PersonalAccessTokenSummary[]>([]);
  const [patLabel, setPatLabel] = useState("");
  const [showPatGen, setShowPatGen] = useState(false);
  const [generatingPat, setGeneratingPat] = useState(false);
  const [generatedPat, setGeneratedPat] = useState<string | null>(null);
  const [revokingPatId, setRevokingPatId] = useState<string | null>(null);

  useEffect(() => {
    void listPersonalAccessTokens().then((res) => {
      if (res.success) setPatTokens(res.tokens);
    });
  }, []);

  const handleGeneratePat = async () => {
    setGeneratingPat(true);
    try {
      const res = await createPersonalAccessToken({
        label: patLabel.trim() || "CLI & Git HTTPS Token",
        scopes: ["repo:read", "repo:write", "task:write"],
        expiresInDays: 90,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setGeneratedPat(res.rawToken);
      setPatTokens((prev) => [res.token, ...prev]);
      toast.success("Personal Access Token created");
    } finally {
      setGeneratingPat(false);
    }
  };

  const handleRevokePat = async (tokenId: string) => {
    setRevokingPatId(tokenId);
    try {
      const res = await revokePersonalAccessToken(tokenId);
      if (res.success) {
        setPatTokens((prev) => prev.filter((t) => t.id !== tokenId));
        toast.success("Personal Access Token revoked");
      } else {
        toast.error(res.error);
      }
    } finally {
      setRevokingPatId(null);
    }
  };

  const extra = more && more.base === sessionData ? more : null;
  const hasMoreSessions = extra ? extra.hasMore : Boolean(sessionData?.hasMore);
  const nextSessionCursor = extra ? extra.cursor : (sessionData?.nextCursor ?? null);
  const allSessions = [...(sessionData?.sessions || []), ...(extra?.sessions ?? [])];
  const loadMoreSessions = async () => {
    if (!nextSessionCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getActiveExtensionSessions({ cursor: nextSessionCursor });
      if (!result.success) throw new Error(result.error);
      const page = result.sessions.map((session): ExtensionSessionData => ({
        ...session,
        expiresAt: new Date(session.expiresAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        createdAt: new Date(session.createdAt).toISOString(),
      }));
      setMore({ base: sessionData, sessions: [...(extra?.sessions ?? []), ...page], cursor: result.nextCursor ?? null, hasMore: result.hasMore });
    } catch {
      toast.warning("More sessions didn’t load", { description: "Try again." });
    } finally {
      setLoadingMore(false);
    }
  };
  const activeSessions = allSessions.filter((s) => s.clientVersion !== "pending" && (s.editorPlatform || s.editorName));
  const pendingSessions = allSessions.filter((s) => s.clientVersion === "pending" || (!s.editorPlatform && !s.editorName));

  useEffect(() => {
    // Google comes back through the same callback; a return with no error code means it linked.
    const google = searchParams.get("identityProvider") === "google";
    const outcome = searchParams.get("githubIdentity") ?? (google ? "linked" : null);
    if (!outcome) return;
    const label = google ? "Google" : "GitHub";
    if (outcome === "replaced") {
      toast.success("GitHub account replaced");
    } else if (outcome === "linked") {
      toast.success(`${label} account linked`);
    } else if (outcome === "already_linked") {
      toast.info(`This ${label} account is already linked`);
    } else if (outcome === "error") {
      const desc = searchParams.get("githubErrorDesc");
      toast.error(feedbackError(desc || `Couldn’t link ${label} account. Try again.`, `Couldn’t link ${label} account. Try again.`));
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("identityProvider");
    next.delete("githubIdentity");
    next.delete("githubErrorDesc");
    const query = next.toString();
    router.replace(`/settings${query ? `?${query}` : ""}#settings-integrations`, { scroll: false });
    void refetch();
  }, [refetch, router, searchParams]);

  // ponytail: auto-reconcile live connection when manual token has been generated. ceiling: 60s cutoff (20 attempts * 3s). upgrade: WebSocket Realtime push invalidation on token attachment.
  useEffect(() => {
    if (!generatedToken || !showTokenGen) return;

    let attempts = 0;
    const maxAttempts = 20; // Stop polling after 60 seconds (20 * 3s)
    const interval = setInterval(async () => {
      if (document.hidden) return;
      attempts += 1;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        return;
      }
      const res = await refetchSessions();
      const current = res.data?.sessions || [];
      const newActiveCount = current.filter((s) => s.clientVersion !== "pending" && (s.editorPlatform || s.editorName)).length;
      if (newActiveCount > activeSessions.length) {
        toast.success("Editor connected");
        setGeneratedToken(null);
        setShowTokenGen(false);
        setDeviceLabel("");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [generatedToken, showTokenGen, refetchSessions, activeSessions.length]);

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    try {
      const label = deviceLabel.trim() || "Access token";
      const result = await generateExtensionToken(label);
      if (result.success && result.rawToken) {
        setGeneratedToken(result.rawToken);
        await refetchSessions();
      } else if ("stepUpRequired" in result && result.stepUpRequired) {
        await requestStepUp("token");
      } else {
        toast.error(feedbackError(result.error || "Couldn’t generate token", "Couldn’t generate token"));
      }
    } catch {
      toast.error("Couldn’t generate token");
    } finally {
      setGeneratingToken(false);
    }
  };

  const linkProvider = async (provider: "google" | "github") => {
    setLinking(provider);
    try {
      if (provider === "github") {
        await startGithubIdentityLink();
        return;
      }
      await startGoogleIdentityLink();
    } catch (linkError) {
      toast.error(feedbackError(linkError instanceof Error ? linkError.message : `Couldn’t link ${provider}`, "Action couldn’t finish"));
      setLinking(null);
    }
  };

  const requestStepUp = async (purpose: "replace" | "token" | "unlink") => {
    try {
      const response = await fetch("/api/v1/auth/security-step-up");
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "Couldn’t load verification options");
      }
      const methods = Array.isArray(payload?.data?.availableMethods)
        ? payload.data.availableMethods.filter(
            (method: unknown): method is "totp" | "recovery_code" | "password" =>
              method === "totp" || method === "recovery_code" || method === "password",
          )
        : [];
      if (!methods.length) {
        toast.warning(purpose === "token" ? "Add a password or authenticator in Security before creating a token" : purpose === "unlink" ? "Add a password or authenticator in Security before disconnecting a sign-in method" : "Add a sign-in method first");
        return;
      }
      setStepUpPurpose(purpose);
      setReplacementMethods(methods);
      setReplacementFactorId(
        typeof payload?.data?.primaryTotpFactorId === "string"
          ? payload.data.primaryTotpFactorId
          : undefined,
      );
      setReplacementConfirmOpen(false);
      setStepUpOpen(true);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t start verification", "Couldn’t start verification"));
    }
  };
  const requestReplacementVerification = () => requestStepUp("replace");

  const unlinkProvider = async (provider: "google" | "github") => {
    unlinkPending.current = provider;
    const response = await fetch("/api/v1/integrations/unlink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
    const payload = await response.json().catch(() => null);
    if (response.status === 403 && payload?.errorCode === "STEP_UP_REQUIRED") {
      await requestStepUp("unlink");
      return;
    }
    if (!response.ok || payload?.success === false) {
      toast.warning(payload?.message || "That sign-in method could not be disconnected");
      return;
    }
    unlinkPending.current = null;
    toast.success(`${provider === "google" ? "Google" : "GitHub"} disconnected`);
    void refetch();
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  };

  const replaceGithubAccount = async () => {
    setReplacingGithub(true);
    try {
      await startGithubIdentityLink({
        nextPath: "/settings?tab=integrations&githubIdentity=replaced",
        // ponytail: the old identity is detached before the redirect because an account can hold one identity per provider; GitHub would refuse the new link otherwise. The dialog says so. Ceiling: an abandoned round trip leaves GitHub disconnected.
        beforeRedirect: async () => {
          const response = await fetch("/api/v1/github/account/replacement", { method: "POST" });
          const payload = await response.json().catch(() => null);
          if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || "The unavailable GitHub account could not be detached");
          }
        },
      });
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t replace GitHub account", "Couldn’t replace GitHub account"));
      setReplacingGithub(false);
      void refetch();
    }
  };

  const revoke = async (sessionId: string) => {
    setRevoking(sessionId);

    // ponytail: optimistic cache update removes row immediately for 0ms perceived lag. ceiling: optimistic single-row deletion. upgrade: server confirmation rollback if mutation fails.
    const previousSessions = queryClient.getQueryData<ExtensionSessionsData>(queryKeys.settings.extensionSessions());
    if (previousSessions) {
      queryClient.setQueryData<ExtensionSessionsData>(queryKeys.settings.extensionSessions(), {
        ...previousSessions,
        sessions: previousSessions.sessions.filter((s) => s.id !== sessionId),
      });
    }

    try {
      const result = await revokeExtensionSession(sessionId);
      if (result.success) {
        toast.success("Editor session revoked");
        void refetchSessions();
        if (result.disconnectUri) {
          window.location.assign(result.disconnectUri);
        }
      } else {
        if (previousSessions) {
          queryClient.setQueryData(queryKeys.settings.extensionSessions(), previousSessions);
        }
        toast.error(feedbackError(result.error || "Couldn’t revoke editor session", "Couldn’t revoke editor session"));
      }
    } catch {
      if (previousSessions) {
        queryClient.setQueryData(queryKeys.settings.extensionSessions(), previousSessions);
      }
      toast.error("Couldn’t revoke editor session");
    } finally {
      setRevoking(null);
    }
  };

  return <div className="space-y-8">
    {error ? <ErrorNotice what="Integrations" onRetry={() => void refetch()} /> : null}

    <SettingsSectionCard id="settings-integrations-connections" title="Sign-in methods" description={data?.summary || "Sign-in methods attached to this account."}>
      {isLoading ? <div role="status" aria-label="Loading connections" className="nb-skeleton h-32 rounded-md" /> : <div>{data?.authConnections.map((provider) => <ProviderRow key={provider.provider} provider={provider} linking={linking === provider.provider} onLink={() => void linkProvider(provider.provider as "google" | "github")} onUnlink={() => setUnlinkConfirm(provider.provider as "google" | "github")} />)}</div>}
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-integrations-github" title="GitHub" description="Repository access is managed from each workspace; this page only shows account-level status.">
      <div className="flex min-h-16 flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Github className="size-5" strokeWidth={1.75} /></span>
          <div className="min-w-0">
            <p className="nb-ui-label text-foreground">{data?.githubService.summary || "GitHub status unavailable"}</p>
            <p className="nb-compact mt-1 text-muted-foreground">{data?.githubService.detail}</p>
            {data?.githubService.githubUsername ? <a href={`https://github.com/${data.githubService.githubUsername}`} target="_blank" rel="noreferrer" className="nb-meta mt-1 inline-block text-primary hover:underline">@{data.githubService.githubUsername}</a> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {data?.githubService.recoveryAction === "replace_account" ? <Button variant="outline" size="sm" onClick={() => setReplacementConfirmOpen(true)} disabled={replacingGithub}>{replacingGithub ? <Loader2 className="size-4 animate-spin" /> : null}Replace GitHub account</Button> : null}
          {data?.githubService.recoveryAction === "add_fallback_sign_in" ? <Button variant="outline" size="sm" onClick={() => void linkProvider("google")} disabled={linking === "google"}>{linking === "google" ? <Loader2 className="size-4 animate-spin" /> : null}Link Google first</Button> : null}
          {data?.githubService.usageCount ? <Button variant="outline" size="sm" onClick={() => setProjectsExpanded((prev) => !prev)} aria-expanded={projectsExpanded}><Link2 className="size-4" strokeWidth={1.75} />Review {data.githubService.usageCount} project{data.githubService.usageCount === 1 ? "" : "s"}<ChevronDown className={`size-4 transition-transform duration-[130ms] ${projectsExpanded ? "rotate-180" : ""}`} /></Button> : null}
        </div>
      </div>

      {projectsExpanded ? <div className="border-y border-border py-2">
        <p className="nb-meta py-2 text-muted-foreground">Connected workspaces</p>
        <div className="divide-y divide-border">
          {data?.githubService.projects?.length ? data.githubService.projects.map((project) => {
            const repoName = project.syncRepository || project.githubRepoUrl || project.importSource?.repoUrl;
            const connectionType = project.syncRepository ? "GitHub sync" : "Repository";
            return <div key={project.id} className="flex min-h-16 items-center justify-between gap-3 py-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link href={`/workspaces/${project.slug}`} className="nb-ui-label block truncate text-foreground hover:text-primary">{project.title}</Link><span className="nb-meta text-muted-foreground">{connectionType}</span></div>{repoName ? <p className="nb-meta mt-1 flex items-center gap-1.5 truncate text-muted-foreground"><GitBranch className="size-3.5 shrink-0" strokeWidth={1.75} />{repoName}{project.syncBranch ? ` · ${project.syncBranch}` : ""}</p> : null}</div>
              <Button variant="ghost" size="sm" asChild><Link href={`/workspaces/${project.slug}`}>Open<ExternalLink className="size-4" strokeWidth={1.75} /></Link></Button>
            </div>;
          }) : <p className="nb-compact py-4 text-muted-foreground">No connected workspaces.</p>}
        </div>
      </div> : null}

      <div className="pt-5"><GitHubCommitAttributionSettings /></div>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-integrations-editors" title="Connected editors" description="Editors signed in to your account, and access tokens.">
      <div className="space-y-4">
        <ExtensionAppCard />
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <h4 className="nb-ui-label text-foreground">Signed-in devices</h4>
            <span className="nb-meta text-muted-foreground">
              {activeSessions.length} active · {pendingSessions.length} pending
            </span>
          </div>
        {sessionsFailed && !sessionData ? (
            <ErrorNotice what="Connected editors" onRetry={() => void refetchSessions()} />
        ) : sessionsLoading && !sessionData ? (
            <div role="status" aria-label="Loading editor sessions" className="nb-skeleton h-24 rounded-md" />
        ) : allSessions.length ? (
            <div className="divide-y divide-border border-y border-border">
              {activeSessions.map((session) => (
                  <ExtensionSessionRow
                    key={session.id}
                    session={session}
                    revoking={revoking === session.id}
                    onRevoke={() => setRevokeTarget(session)}
                  />
              ))}
              {pendingSessions.map((session) => (
                  <ExtensionSessionRow
                    key={session.id}
                    session={session}
                    revoking={revoking === session.id}
                    onRevoke={() => setRevokeTarget(session)}
                  />
              ))}
              {hasMoreSessions ? (
                <div className="flex justify-center py-3">
                  <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMoreSessions()} className="pointer-coarse:h-11">{loadingMore ? "Loading…" : "Load more sessions"}</Button>
                </div>
              ) : null}
            </div>
        ) : (
            <p className="rounded-md border border-dashed border-border bg-card nb-grid-ground p-6 text-center nb-compact text-muted-foreground" role="status">
            No active editor sessions.
          </p>
        )}
        </div>

        <div id="settings-integrations-token" className="scroll-mt-6 border-t border-border pt-4">
          <SettingsRow
            title="Access tokens"
            description="A fallback if signing in from your editor is blocked. It works for one year until you revoke it, so treat it like a password."
            right={<Button size="sm" variant="outline" onClick={() => {
              // Closing the panel also forgets the token: it is shown once and is not kept on screen.
              if (showTokenGen) { setGeneratedToken(null); setDeviceLabel(""); }
              setShowTokenGen(!showTokenGen);
            }} className="pointer-coarse:h-11">
              {showTokenGen ? "Cancel" : "Generate token"}
            </Button>}
          />

          {showTokenGen && (
            <div className="mt-3 border-t border-border pt-4">
              {!generatedToken ? (
                <div className="space-y-3">
                  <div className="max-w-xs space-y-1.5">
                    <label htmlFor="extension-token-label" className="nb-ui-label text-foreground">Device label (optional)</label>
                    <Input id="extension-token-label" type="text" maxLength={120} value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} placeholder="e.g. Workstation" />
                  </div>
                  <Button size="sm" onClick={() => void handleGenerateToken()} disabled={generatingToken}>
                    {generatingToken ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" strokeWidth={1.75} />}
                    Generate new token
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="text"
                      readOnly
                      aria-label="Your new token"
                      value={generatedToken}
                      className="nb-meta"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        copyText(generatedToken).then(
                          () => toast.success("Copied to clipboard"),
                          () => toast.warning("Couldn’t copy", { description: "Select the token and copy it by hand." }),
                        );
                      }}
                      className="shrink-0"
                    >
                      <Copy className="size-4" strokeWidth={1.75} /> Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setGeneratedToken(null);
                        setShowTokenGen(false);
                        setDeviceLabel("");
                      }}
                      className="shrink-0"
                    >
                      Done
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-border bg-background p-3 nb-compact text-muted-foreground">
                    <KeyRound className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                    <span>
                      Paste it into your editor’s authentication prompt or run{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                        nb auth login --token {generatedToken}
                      </code>{" "}
                      in your terminal. It is shown only once and works for one year.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div id="settings-integrations-pat" className="scroll-mt-6 border-t border-border pt-4">
          <SettingsRow
            title="Personal access tokens (CLI & Git HTTPS)"
            description="Fine-grained tokens (nb_pat_...) for the NetworkBase CLI, Git credential helper, and CI/CD pipelines."
            right={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (showPatGen) {
                    setGeneratedPat(null);
                    setPatLabel("");
                  }
                  setShowPatGen(!showPatGen);
                }}
                className="pointer-coarse:h-11"
              >
                {showPatGen ? "Cancel" : "New CLI token"}
              </Button>
            }
          />

          {showPatGen && (
            <div className="mt-3 border-t border-border pt-4">
              {!generatedPat ? (
                <div className="space-y-3">
                  <div className="max-w-xs space-y-1.5">
                    <label htmlFor="cli-pat-label" className="nb-ui-label text-foreground">
                      Token label
                    </label>
                    <Input
                      id="cli-pat-label"
                      type="text"
                      maxLength={80}
                      value={patLabel}
                      onChange={(e) => setPatLabel(e.target.value)}
                      placeholder="e.g. MacBook Pro CLI"
                    />
                  </div>
                  <Button size="sm" onClick={() => void handleGeneratePat()} disabled={generatingPat}>
                    {generatingPat ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Terminal className="size-4" strokeWidth={1.75} />
                    )}
                    Create personal access token
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="text"
                      readOnly
                      aria-label="Your new personal access token"
                      value={generatedPat}
                      className="nb-meta font-mono"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        copyText(generatedPat).then(
                          () => toast.success("Copied to clipboard"),
                          () => toast.warning("Couldn’t copy"),
                        );
                      }}
                      className="shrink-0"
                    >
                      <Copy className="size-4" strokeWidth={1.75} /> Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setGeneratedPat(null);
                        setShowPatGen(false);
                        setPatLabel("");
                      }}
                      className="shrink-0"
                    >
                      Done
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-border bg-background p-3 nb-compact text-muted-foreground">
                    <Terminal className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                    <span>
                      Run{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                        nb auth login --token {generatedPat}
                      </code>{" "}
                      to sign in from your terminal.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {patTokens.length > 0 && (
            <div className="mt-3 divide-y divide-border rounded-md border border-border px-3">
              {patTokens.map((pat) => (
                <div
                  key={pat.id}
                  className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="nb-ui-label text-foreground">{pat.label}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {pat.tokenPrefix}
                      </code>
                      {pat.isExpiringSoon && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          Expiring soon
                        </span>
                      )}
                    </div>
                    <p className="nb-meta mt-1 text-muted-foreground">
                      Scopes: {pat.scopes.join(", ")} · Created{" "}
                      {formatDistanceToNow(new Date(pat.createdAt), { addSuffix: true })}
                      {pat.lastUsedAt
                        ? ` · Last used ${formatDistanceToNow(new Date(pat.lastUsedAt), { addSuffix: true })}`
                        : " · Never used"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revokingPatId === pat.id}
                    onClick={() => void handleRevokePat(pat.id)}
                  >
                    {revokingPatId === pat.id ? <Loader2 className="size-4 animate-spin" /> : null}
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsSectionCard>

    <Dialog open={replacementConfirmOpen} onOpenChange={setReplacementConfirmOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replace the unavailable GitHub account?</DialogTitle>
          <DialogDescription>
            NetworkBase will detach {data?.githubService.githubUsername ? `@${data.githubService.githubUsername}` : "the unavailable account"} and then ask you to choose a new GitHub account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-md border border-border bg-muted/50 p-4 nb-compact text-muted-foreground">
          <p>Workspace files, repository links, sync history, and past contributor credit stay unchanged.</p>
          <p>Repository access is reviewed per workspace after the new account is linked.</p>
          <p>Only future commits switch to the new account’s privacy-safe GitHub identity.</p>
          <p className="font-medium text-foreground">GitHub stays disconnected until you finish choosing a new account. If you leave before that, come back here and connect again.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReplacementConfirmOpen(false)}>Cancel</Button>
          <Button onClick={() => void requestReplacementVerification()}>Verify and continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <SecurityStepUpDialog
      open={stepUpOpen}
      onOpenChange={setStepUpOpen}
      title={stepUpPurpose === "token" ? "Verify before creating a token" : stepUpPurpose === "unlink" ? "Verify before disconnecting" : "Verify this GitHub account change"}
      description={stepUpPurpose === "token" ? "A token signs in as you for a year, so confirm it is you first." : stepUpPurpose === "unlink" ? "Removing a way to sign in is a security change, so confirm it is you first." : "Confirm your NetworkBase identity before the unavailable GitHub account is detached."}
      availableMethods={replacementMethods}
      factorId={replacementFactorId}
      onVerified={stepUpPurpose === "token" ? handleGenerateToken : stepUpPurpose === "unlink" ? () => (unlinkPending.current ? unlinkProvider(unlinkPending.current) : undefined) : replaceGithubAccount}
    />

    <ConfirmDialog
      open={unlinkConfirm !== null}
      onOpenChange={(open) => { if (!open) setUnlinkConfirm(null); }}
      title={`Disconnect ${unlinkConfirm === "google" ? "Google" : "GitHub"}?`}
      description={unlinkConfirm === "github" ? "You will no longer be able to sign in with GitHub, and repository access from this account stops. Your workspaces stay as they are." : "You will no longer be able to sign in with Google. You need another way to sign in first."}
      confirmLabel="Disconnect"
      variant="destructive"
      onConfirm={() => (unlinkConfirm ? unlinkProvider(unlinkConfirm) : undefined)}
    />

    <ConfirmDialog
      open={revokeTarget !== null}
      onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
      title={revokeTarget && (revokeTarget.clientVersion === "pending" || (!revokeTarget.editorPlatform && !revokeTarget.editorName)) ? "Revoke this token?" : "Disconnect this editor?"}
      description="It will stop working right away. You can connect again any time."
      confirmLabel="Disconnect"
      variant="destructive"
      onConfirm={() => revokeTarget ? revoke(revokeTarget.id) : undefined}
    />
  </div>;
}
