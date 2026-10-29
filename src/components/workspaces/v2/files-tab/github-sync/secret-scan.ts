
export function scanForSecrets(
  path: string,
  content?: string | null,
): { blocked: boolean; reason?: string } {
  const lowerPath = path.toLowerCase();
  const isEnvTemplate =
    lowerPath.endsWith(".example") ||
    lowerPath.endsWith(".sample") ||
    lowerPath.endsWith(".template") ||
    lowerPath.endsWith(".dist");

  const isSensitiveEnv =
    !isEnvTemplate &&
    (lowerPath.endsWith(".env") ||
      /(^|\/)\.env\.(?!example|sample|template|dist)[a-z0-9_.-]+$/i.test(lowerPath));

  if (
    isSensitiveEnv ||
    lowerPath.endsWith(".pem") ||
    lowerPath.endsWith(".key")
  ) {
    return {
      blocked: true,
      reason: `Sensitive configuration file pattern (${path})`,
    };
  }
  if (!content) return { blocked: false };

  if (content.includes("PRIVATE KEY") && /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(content)) {
    return { blocked: true, reason: "Private cryptographic key detected" };
  }
  if (content.includes("AKIA") && /AKIA[0-9A-Z]{16}/.test(content)) {
    return { blocked: true, reason: "AWS Access Key ID detected" };
  }
  if ((content.includes("ghp_") || content.includes("github_pat_")) && /ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82}/.test(content)) {
    return { blocked: true, reason: "GitHub Personal Access Token detected" };
  }
  if (content.includes("sk_live_") && /sk_live_[0-9a-zA-Z]{24,}/.test(content)) {
    return { blocked: true, reason: "Stripe Live Secret Key detected" };
  }
  if (content.includes("sk-") && /sk-(?:proj-)?[0-9a-zA-Z_-]{32,}/.test(content)) {
    return { blocked: true, reason: "OpenAI API Key detected" };
  }
  return { blocked: false };
}
