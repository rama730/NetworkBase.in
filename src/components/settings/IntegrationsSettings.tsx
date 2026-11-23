"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/utils/date";
import { ChevronDown, Code2, Copy, ExternalLink, GitBranch, KeyRound, Terminal, X } from "lucide-react";
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
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tag } from "@/components/settings/mix/parts";
import { padCount } from "@/lib/ui/tab-marker";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useExtensionSessionsData, useIntegrationsData } from "@/hooks/useSettingsQueries";
import { startGithubIdentityLink } from "@/lib/github/oauth-client";
import { jumpToSetting } from "@/components/settings/mix/jump";
import { GitHubCommitAttributionSettings } from "@/components/settings/GitHubCommitAttributionSettings";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { revokeExtensionSession, generateExtensionToken, getActiveExtensionSessions } from "@/app/actions/extension-sessions";
import {
  listPersonalAccessTokens,
  revokePersonalAccessToken,
  type PersonalAccessTokenSummary,
} from "@/app/actions/personal-access-tokens";
import type { ExtensionSessionData, ExtensionSessionsData } from "@/types/settingsTypes";
import { copyText } from "@/lib/clipboard";
import { TerminalBlock } from "@/components/ui/terminal-block";
import { PersonalTokenForm, scopeWords } from "@/components/settings/PersonalTokenForm";
import { AgentActivity } from "@/components/settings/AgentActivity";

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
    <div className="nbs-pad grid gap-2">
      <TerminalBlock variant="command" label="Terminal">{"$ npx @networkbase/cli login\n$ nb agent setup claude"}</TerminalBlock>
      <p className="nbs-meta">Sign in from your editor or terminal, then link a folder with nb init. Agents get their own sign-in: where they work, what they may do and for how long. <Link href="/docs/cli" className="underline underline-offset-2">CLI docs</Link> · <Link href="/docs/agents" className="underline underline-offset-2">Agents</Link></p>
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
  const title = session.tokenType === "agent"
    ? `${session.agentName?.trim() || "AI agent"} on ${session.deviceName?.trim() || "a computer"}`
    : isPending
      ? session.deviceName?.trim() || "Access token"
      // A terminal says which computer it's on, so two sign-ins can be told apart (T16 live test).
      : isCliSession && session.deviceName?.trim() && !session.deviceName.toLowerCase().includes("cli")
        ? `NetworkBase CLI on ${session.deviceName.trim().replace(/\.local$/i, "")}`
        : session.editorName?.trim() || session.deviceName?.trim() || (isCliSession ? "NetworkBase CLI" : "Editor extension");

  const tile = ideIcon
    ? <span className="tile" aria-hidden="true"><Image src={ideIcon} alt="" width={20} height={20} unoptimized className="size-5 object-contain" /></span>
    : <span className="tile" aria-hidden="true">{isCliSession ? <Terminal strokeWidth={1.75} /> : isPending ? <KeyRound strokeWidth={1.75} /> : <Code2 strokeWidth={1.75} />}</span>;
  const detail = isPending
    ? `access token · made ${formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })} · waiting for its first sign-in`
    : [`active ${formatDistanceToNow(new Date(session.lastSeenAt), { addSuffix: true })}`, platform, `v${session.clientVersion || "unknown"}`,
      session.tokenType === "agent" ? null : isCliSession ? "from the CLI" : session.authMethod === "web_login" ? "from the editor" : "access token",
      session.lastCountry ? `last used from ${session.lastCountry}` : null,
      session.tokenType === "agent" ? null : `expires ${formatDistanceToNow(new Date(session.expiresAt), { addSuffix: true })}`].filter(Boolean).join(" · ");
  return (
    <SecurityListRow
      tile={tile}
      title={title}
      badges={session.tokenType === "agent" ? <Tag tone="hot">Agent</Tag> : isCliSession ? <Tag>CLI</Tag> : isPending ? <Tag tone="warn">Waiting</Tag> : null}
      details={detail}
      summary={session.tokenType === "agent" ? (session.accessSentence ?? `Works in ${session.workspaceTitle ?? "all your workspaces"}; big changes wait for your yes.`) : undefined}
      action={<>
        {session.tokenType === "agent" ? <Button size="sm" variant="outline" asChild><Link href={`/settings/agents/${session.id}`}>Change access</Link></Button> : null}
        <Button pending={revoking} size="sm" variant="ghost" onClick={onRevoke} disabled={revoking}>{isPending ? "Revoke" : "Disconnect"}</Button>
      </>}
    >
      {session.tokenType === "agent" ? <AgentActivity sessionId={session.id} /> : null}
    </SecurityListRow>
  );
}

export default function IntegrationsSettings() {
  const queryClient = useQueryClient();
  const { data, error, refetch } = useIntegrationsData();
  const { data: sessionData, isLoading: sessionsLoading, isError: sessionsFailed, refetch: refetchSessions } = useExtensionSessionsData();
  // Sessions past the first page, loaded on request; dropped whenever the first page is read again.
  const [more, setMore] = useState<{ base: unknown; sessions: ExtensionSessionData[]; cursor: string | null; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showTokenGen, setShowTokenGen] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [replacementConfirmOpen, setReplacementConfirmOpen] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // What the verification is for: replacing the GitHub account, or creating a manual token.
  const [stepUpPurpose, setStepUpPurpose] = useState<"replace" | "token">("replace");
  const [revokeTarget, setRevokeTarget] = useState<ExtensionSessionData | null>(null);
  const [replacementMethods, setReplacementMethods] = useState<Array<"totp" | "recovery_code" | "password">>([]);
  const [replacementFactorId, setReplacementFactorId] = useState<string | undefined>();
  const [replacingGithub, setReplacingGithub] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [patTokens, setPatTokens] = useState<PersonalAccessTokenSummary[]>([]);
  const [showPatGen, setShowPatGen] = useState(false);
  const [revokingPatId, setRevokingPatId] = useState<string | null>(null);

  useEffect(() => {
    void listPersonalAccessTokens().then((res) => {
      if (res.success) setPatTokens(res.tokens);
    });
  }, []);

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

  const requestStepUp = async (purpose: "replace" | "token") => {
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
        toast.warning(purpose === "token" ? "Add a password or authenticator in Security before creating a token" : "Add a sign-in method first");
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

  const github = data?.githubService;
  return <>
    {error ? <div className="nbs-body pt-4"><ErrorNotice what="Integrations" onRetry={() => void refetch()} /></div> : null}

    <SettingsSectionCard id="settings-integrations-github" title="GitHub" flush findKeys="repository repo commit">
      <SettingsRows>
        <SettingsRow
          id="settings-integrations-repos"
          title="Repository access"
          description={[github?.summary, github?.detail].filter(Boolean).join(" ") || "Managed from each workspace."}
          meta={github?.githubUsername ? <a href={`https://github.com/${github.githubUsername}`} target="_blank" rel="noreferrer" className="hover:underline">@{github.githubUsername}</a> : undefined}
          right={<>
            {github?.recoveryAction === "replace_account" ? <Button pending={replacingGithub} variant="outline" size="sm" onClick={() => setReplacementConfirmOpen(true)} disabled={replacingGithub}>Replace GitHub account</Button> : null}
            {github?.recoveryAction === "add_fallback_sign_in" ? <Button variant="outline" size="sm" onClick={() => jumpToSetting("settings-security-google")}>Link Google first</Button> : null}
            {github?.usageCount ? <Button variant="outline" size="sm" onClick={() => setProjectsExpanded((prev) => !prev)} aria-expanded={projectsExpanded}>{padCount(github.usageCount)} workspace{github.usageCount === 1 ? "" : "s"}<ChevronDown className={`size-4 transition-transform duration-[130ms] ${projectsExpanded ? "rotate-180" : ""}`} /></Button> : <span className="v text-muted-foreground">00 workspaces</span>}
          </>}
        >
          {projectsExpanded ? <div className="nbs-list -mx-[var(--nbs-pad)] mt-2">
            {github?.projects?.length ? github.projects.map((project) => {
              const repoName = project.syncRepository || project.githubRepoUrl || project.importSource?.repoUrl;
              return <SecurityListRow key={project.id} icon={GitBranch} title={<Link href={`/workspaces/${project.slug}`} className="hover:underline">{project.title}</Link>}
                badges={<Tag>{project.syncRepository ? "Sync" : "Repository"}</Tag>}
                details={repoName ? `${repoName}${project.syncBranch ? ` · ${project.syncBranch}` : ""}` : undefined}
                action={<Button variant="ghost" size="sm" asChild><Link href={`/workspaces/${project.slug}`}>Open<ExternalLink className="size-4" strokeWidth={1.75} /></Link></Button>} />;
            }) : <p className="nbs-ghelp">No connected workspaces.</p>}
          </div> : null}
        </SettingsRow>
        <GitHubCommitAttributionSettings />
      </SettingsRows>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-integrations-editors" title="CLI, agents and editors" state={padCount(activeSessions.length)} stateOk={activeSessions.length > 0} flush findKeys="terminal cli agents mcp editor vscode claude">
      <ExtensionAppCard />
      {sessionsFailed && !sessionData ? (
        <div className="nbs-body"><ErrorNotice what="Connected editors" onRetry={() => void refetchSessions()} /></div>
      ) : sessionsLoading && !sessionData ? (
        <div role="status" aria-label="Loading editor sessions" className="nbs-li"><span className="tile" /><div className="nb-skeleton h-8 rounded" /><span /></div>
      ) : allSessions.length ? (
        <div className="nbs-list">
          {[...activeSessions, ...pendingSessions].map((session) => <ExtensionSessionRow key={session.id} session={session} revoking={revoking === session.id} onRevoke={() => setRevokeTarget(session)} />)}
        </div>
      ) : (
        <EmptyState compact figure="workspace" className="nbs-empty" title="No editors or agents signed in" description="Sign in from your editor or terminal with the commands above. They show up here, and you can change what each may do." />
      )}
      {hasMoreSessions ? <div className="nbs-more"><Button pending={loadingMore} pendingLabel="Loading" type="button" variant="ghost" size="sm" disabled={loadingMore} onClick={() => void loadMoreSessions()}>Load more</Button></div> : null}
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-integrations-tokens" title="Tokens" state={patTokens.length ? padCount(patTokens.length) : undefined} stateOk flush findKeys="api token pat personal access key">
      <SettingsRows>
        <SettingsRow
          id="settings-integrations-token-new"
          title="Personal access token"
          description="For scripts and CI (NETWORKBASE_TOKEN). Choose what it may do, which workspaces it reaches and when it ends. Treat it like a password."
          right={<Button size="sm" variant="outline" onClick={() => setShowPatGen(!showPatGen)}>{showPatGen ? "Cancel" : "New token"}</Button>}
        >
          {showPatGen ? <div className="nbs-inline-form max-w-[560px]"><PersonalTokenForm onCreated={(token) => setPatTokens((prev) => [token, ...prev])} onDone={() => setShowPatGen(false)} /></div> : null}
        </SettingsRow>
        {patTokens.map((pat) => (
          <SettingsRow
            key={pat.id}
            title={pat.label}
            meta={`${pat.tokenPrefix} · can ${scopeWords(pat.scopes)} · ${pat.workspaceTitle ? `only ${pat.workspaceTitle}` : "all workspaces"} · made ${formatDistanceToNow(new Date(pat.createdAt), { addSuffix: true })} · ${pat.lastUsedAt ? `used ${formatDistanceToNow(new Date(pat.lastUsedAt), { addSuffix: true })}` : "never used"}`}
            right={<>
              {pat.isExpiringSoon ? <Tag tone="warn">Expiring soon</Tag> : null}
              <button type="button" className="nbs-ib danger" aria-label={`Revoke ${pat.label}`} disabled={revokingPatId === pat.id} onClick={() => void handleRevokePat(pat.id)}><X strokeWidth={1.75} aria-hidden="true" /></button>
            </>}
          />
        ))}
        <SettingsRow
          id="settings-integrations-editor-token"
          title="Editor access token"
          description="A fallback if signing in from your editor is blocked. It works for one year until you revoke it."
          right={<Button size="sm" variant="outline" onClick={() => {
            // Closing the panel also forgets the token: it is shown once and is not kept on screen.
            if (showTokenGen) { setGeneratedToken(null); setDeviceLabel(""); }
            setShowTokenGen(!showTokenGen);
          }}>{showTokenGen ? "Cancel" : "Make a token"}</Button>}
        >
          {showTokenGen ? (!generatedToken ? (
            <div className="nbs-inline-form">
              <div className="grid gap-1.5">
                <label htmlFor="extension-token-label" className="text-[13px] font-medium">Device label (optional)</label>
                <Input id="extension-token-label" type="text" maxLength={120} value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} placeholder="Workstation" />
              </div>
              <div><Button pending={generatingToken} size="sm" onClick={() => void handleGenerateToken()} disabled={generatingToken}>Make token</Button></div>
            </div>
          ) : (
            <div className="nbs-inline-form max-w-[560px]">
              <label className="text-[13px] font-medium" htmlFor="extension-token-value">Your token · shown once</label>
              <div className="flex gap-2">
                <Input id="extension-token-value" type="text" readOnly value={generatedToken} className="font-mono text-[13px]" onClick={(e) => (e.target as HTMLInputElement).select()} />
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => { copyText(generatedToken).then(() => toast.success("Copied"), () => toast.warning("Couldn’t copy", { description: "Select the token and copy it by hand." })); }}><Copy className="size-4" strokeWidth={1.75} />Copy</Button>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { setGeneratedToken(null); setShowTokenGen(false); setDeviceLabel(""); }}>Done</Button>
              </div>
              <span className="nbs-meta">Paste it into your editor’s sign-in prompt, or when nb login --with-token asks. Don’t put it in a command.</span>
            </div>
          )) : null}
        </SettingsRow>
      </SettingsRows>
    </SettingsSectionCard>

    <Dialog open={replacementConfirmOpen} onOpenChange={setReplacementConfirmOpen}>
      <DialogContent>
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
      title={stepUpPurpose === "token" ? "Verify before creating a token" : "Verify this GitHub account change"}
      description={stepUpPurpose === "token" ? "A token signs in as you for a year, so confirm it is you first." : "Confirm your NetworkBase identity before the unavailable GitHub account is detached."}
      availableMethods={replacementMethods}
      factorId={replacementFactorId}
      onVerified={stepUpPurpose === "token" ? handleGenerateToken : replaceGithubAccount}
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
  </>;
}
