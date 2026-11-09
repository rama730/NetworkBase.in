"use client";

import type { UserIdentity } from "@supabase/supabase-js";
import { buildOAuthRedirectTo, resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { continueBrowserOAuthRedirect } from "@/lib/auth/oauth";
import { noteExternalDeparture } from "@/lib/navigation/in-app-history";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearGithubOAuthReturn } from "@/lib/github/oauth-errors";

type GithubOAuthOptions = {
  nextPath?: string;
  scopes?: string;
  login?: string | null;
  isCurrent?: () => boolean;
};

type GithubIdentityLinkOptions = Pick<GithubOAuthOptions, "nextPath"> & {
  beforeRedirect?: () => Promise<void>;
};

const GITHUB_REPOSITORY_SCOPES = "repo workflow user:email read:org";

function createGithubOAuthRequestId() {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `github-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function identityLinkError(error: unknown, provider = "GitHub") {
  const record =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : null;
  const code =
    typeof record?.code === "string" ? record.code.trim().toLowerCase() : "";
  const message =
    typeof record?.message === "string" ? record.message.trim() : "";
  if (
    code === "manual_linking_disabled" ||
    message.toLowerCase().includes("manual linking is disabled")
  ) {
    return new Error(
      `${provider} linking is unavailable because manual identity linking is disabled for this deployment. An administrator must enable Allow manual linking in Supabase Auth, then try again.`,
    );
  }
  return error instanceof Error
    ? error
    : new Error(`Couldn’t link ${provider}`);
}

/**
 * Starts the one canonical GitHub repository-authorization flow.
 *
 * GitHub may already be linked as an identity while the short-lived repository
 * access grant is unavailable. `signInWithOAuth` refreshes that grant and lets
 * the callback persist it in the secure import-access cookie. Sync surfaces must
 * not call `linkIdentity` here: identity linking belongs to Settings.
 */
export async function startGithubRepositoryAuthorization({
  nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`,
  // ponytail: canonical grant covers repository contents and workflow files. ceiling: standard OAuth 2.0 scopes. upgrade: GitHub App fine-grained permissions if user OAuth scopes are restricted by org policy.
  scopes = GITHUB_REPOSITORY_SCOPES,
  login,
  isCurrent,
}: GithubOAuthOptions = {}) {
  const destination = new URL(nextPath, window.location.origin);
  destination.searchParams.delete("githubAuth");
  clearGithubOAuthReturn(destination);
  const requestId = createGithubOAuthRequestId();
  const result = await createSupabaseBrowserClient().auth.signInWithOAuth({
    provider: "github",
    options: {
      scopes,
      ...(isCurrent ? { skipBrowserRedirect: true } : {}),
      queryParams: {
        prompt: "select_account",
        ...(login?.trim() ? { login: login.trim() } : {}),
      },
      redirectTo: buildOAuthRedirectTo(
        resolveAuthBaseUrl(),
        `${destination.pathname}${destination.search}${destination.hash}`,
        requestId,
        "github",
      ),
    },
  });
  if (result.error) throw result.error;
  if (!result.data?.url)
    throw new Error("GitHub authorization could not be started.");
  if (isCurrent) {
    if (!isCurrent()) return;
    const target = new URL(result.data.url);
    const configured = new URL(
      process.env.NEXT_PUBLIC_SUPABASE_URL || window.location.origin,
    );
    if (
      target.origin !== configured.origin ||
      !target.pathname.endsWith("/auth/v1/authorize")
    )
      throw new Error(
        "GitHub sign-in returned an unexpected authorization destination. Try again.",
      );
    noteExternalDeparture();
    window.location.assign(target.href);
  } else continueBrowserOAuthRedirect(result);
}

/**
 * Links a GitHub identity to the currently authenticated NetworkBase account. Unlike
 * repository reauthorization, this must use Supabase identity linking so OAuth
 * can never sign the browser into a different NetworkBase account.
 */
export async function startGithubIdentityLink({
  nextPath = "/settings?tab=integrations&githubIdentity=linked",
  beforeRedirect,
}: GithubIdentityLinkOptions = {}) {
  const destination = new URL(nextPath, window.location.origin);
  destination.searchParams.delete("githubAuth");
  clearGithubOAuthReturn(destination);
  const result = await createSupabaseBrowserClient().auth.linkIdentity({
    provider: "github",
    options: {
      scopes: GITHUB_REPOSITORY_SCOPES,
      queryParams: { prompt: "select_account" },
      // ponytail: obtain provider URL before detaching stale identity. ceiling: browser popup/redirect workflow. upgrade: background OAuth device flow for headless environments.
      skipBrowserRedirect: true,
      redirectTo: buildOAuthRedirectTo(
        resolveAuthBaseUrl(),
        `${destination.pathname}${destination.search}${destination.hash}`,
        createGithubOAuthRequestId(),
        "github",
      ),
    },
  });
  if (result.error) throw identityLinkError(result.error);
  if (!result.data?.url)
    throw new Error("GitHub account linking could not be started.");
  await beforeRedirect?.();
  noteExternalDeparture();
  window.location.assign(result.data.url);
}

/**
 * Links a Google identity to the signed-in account. It returns through /auth/callback like GitHub does, so the
 * code is exchanged on the server, the link is logged and emailed, and Settings can say how it went.
 */
export async function startGoogleIdentityLink() {
  const result = await createSupabaseBrowserClient().auth.linkIdentity({
    provider: "google",
    options: {
      redirectTo: buildOAuthRedirectTo(resolveAuthBaseUrl(), "/settings?tab=integrations&identityProvider=google", createGithubOAuthRequestId(), "google"),
    },
  });
  if (result.error) throw identityLinkError(result.error, "Google");
}

/** Recheck live identities before choosing link versus repository reauthorization. */
export async function startGithubSyncAuthorization({
  nextPath,
  isCurrent = () => true,
}: Pick<GithubOAuthOptions, "nextPath" | "isCurrent"> = {}) {
  const result = await createSupabaseBrowserClient().auth.getUserIdentities();
  if (!isCurrent()) return;
  if (result.error) throw result.error;
  if (!result.data || !Array.isArray(result.data.identities))
    throw new Error("Couldn’t check your linked accounts. Try again.");
  const github = result.data.identities.find((identity: UserIdentity) => identity.provider === "github");
  if (github) {
    const data = github.identity_data;
    const login = data?.user_name || data?.preferred_username || data?.login;
    await startGithubRepositoryAuthorization({
      nextPath,
      login: typeof login === "string" ? login : undefined,
      isCurrent,
    });
  } else {
    await startGithubIdentityLink({
      nextPath,
      beforeRedirect: async () => {
        if (!isCurrent()) throw new Error("Sign-in canceled.");
      },
    });
  }
}
