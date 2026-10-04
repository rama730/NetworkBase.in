
export function scanForSecrets(
  path: string,
  content?: string | null,
): { blocked: boolean; reason?: string } {
  const lowerPath = path.toLowerCase();
  if (
    lowerPath.endsWith(".env") ||
    lowerPath.includes(".env.") ||
    lowerPath.endsWith(".pem") ||
    lowerPath.endsWith(".key")
  ) {
    return {
      blocked: true,
      reason: `Sensitive configuration file pattern (${path})`,
    };
  }
  if (!content) return { blocked: false };

  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(content)) {
    return { blocked: true, reason: "Private cryptographic key detected" };
  }
  if (/AKIA[0-9A-Z]{16}/.test(content)) {
    return { blocked: true, reason: "AWS Access Key ID detected" };
  }
  if (/ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82}/.test(content)) {
    return { blocked: true, reason: "GitHub Personal Access Token detected" };
  }
  if (/sk_live_[0-9a-zA-Z]{24,}/.test(content)) {
    return { blocked: true, reason: "Stripe Live Secret Key detected" };
  }
  if (/sk-(?:proj-)?[0-9a-zA-Z_-]{32,}/.test(content)) {
    return { blocked: true, reason: "OpenAI API Key detected" };
  }
  return { blocked: false };
}
