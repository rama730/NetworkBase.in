/** Preserve actionable OAuth failures instead of labelling every failure cancelled. */
export function githubOAuthFailureCode(code: string | null): string {
  switch (code) {
    case "identity_already_exists":
    case "access_denied":
    case "account_mismatch":
    case "token_missing":
    case "expired":
    case "cancelled":
    case "invalid":
      return code;
    default:
      return "invalid";
  }
}

export function githubOAuthReturnFailure(url: URL): string | null {
  const fragment = new URLSearchParams(url.hash.slice(1));
  // A provider can append its actual error in the fragment after a callback
  // already produced a generic query error. Prefer the actual provider code.
  const providerCode = fragment.get("error_code") || url.searchParams.get("error_code");
  if (providerCode) return githubOAuthFailureCode(providerCode);
  const providerError = fragment.get("error") || url.searchParams.get("error");
  if (providerError) return githubOAuthFailureCode(providerError);
  const code = url.searchParams.get("githubAuth");
  if (code) return githubOAuthFailureCode(code);
  const identity = url.searchParams.get("githubIdentity");
  if (identity === "already_linked") return "identity_already_exists";
  return identity === "error" ? "invalid" : null;
}

/** Remove only OAuth return fields, preserving the workspace URL and anchors. */
export function clearGithubOAuthReturn(url: URL) {
  url.searchParams.delete("githubAuth");
  if (["error", "already_linked"].includes(url.searchParams.get("githubIdentity") || ""))
    url.searchParams.delete("githubIdentity");
  for (const key of ["githubErrorDesc", "error", "error_code", "error_description"])
    url.searchParams.delete(key);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has("error") || fragment.has("error_code")) {
    for (const key of ["error", "error_code", "error_description"])
      fragment.delete(key);
    url.hash = fragment.toString();
  }
}
