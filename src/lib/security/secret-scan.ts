/**
 * Spots credentials in uploaded files (report A3.13, finding 38). The CLI checks the same rules before
 * uploading; the server checks again so every client — browser, editor, agents — is covered.
 */

export type SecretFinding = { path: string; rule: string; line: number | null };

const FILE_NAME_RULES: Array<{ rule: string; test: (name: string) => boolean }> = [
  { rule: "Environment file", test: (n) => n === ".env" || (n.startsWith(".env.") && !n.endsWith(".example") && !n.endsWith(".sample")) },
  { rule: "SSH private key file", test: (n) => /^id_(rsa|dsa|ecdsa|ed25519)$/.test(n) },
  { rule: "Certificate or key bundle", test: (n) => /\.(pem|p12|pfx|key)$/i.test(n) },
];

const CONTENT_RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { rule: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { rule: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { rule: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { rule: "Stripe live key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { rule: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { rule: "NetworkBase token", pattern: /\bnb_(?:dev|agt|pat)_[A-Za-z0-9_-]{16,}\b/ },
  { rule: "npm auth in .npmrc", pattern: /_authToken\s*=\s*\S{8,}/ },
];

/** Bytes scanned per file; credentials sit near the top of real files and this keeps uploads fast. */
const SCAN_BYTES = 2 * 1024 * 1024;

export function scanForSecrets(path: string, content: Uint8Array): SecretFinding[] {
  const name = path.split("/").pop() ?? path;
  const findings: SecretFinding[] = [];
  for (const { rule, test } of FILE_NAME_RULES) if (test(name)) findings.push({ path, rule, line: null });
  const text = Buffer.from(content.subarray(0, SCAN_BYTES)).toString("utf8");
  for (const { rule, pattern } of CONTENT_RULES) {
    const match = pattern.exec(text);
    if (match) findings.push({ path, rule, line: text.slice(0, match.index).split("\n").length });
  }
  return findings;
}
