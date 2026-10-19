import { isSafeHttpUrl } from "@/lib/security/urls";

/** Normalization never edits a URL's path, query or fragment. Prose cleanup is separate. */
export function normalizeSafeExternalUrl(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value || /\s|[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const explicitHttp = /^https?:\/\//i.test(value);
  // A host:port is a bare address; any other explicit scheme must stay a scheme.
  if (!explicitHttp && /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:]+\.\w+:\d+(?:[/?#]|$)/.test(value)) return null;
  if (!explicitHttp && /^(?:\/|[?#])/.test(value)) return null;
  const candidate = explicitHttp ? value : `https://${value}`;
  if (!isSafeHttpUrl(candidate, { maxLength: 2000 })) return null;
  try {
    const parsed = new URL(candidate);
    // Bare tokens must look like web addresses, not a word from a sentence.
    if (!explicitHttp && !parsed.hostname.includes(".")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function parseSafeLinkToken(token: string): { href: string; display: string; trailing: string } | null {
  const raw = token.trim();
  let core = raw.replace(/[.,;!?]+$/, "");
  while (core.endsWith(")") && (core.match(/\)/g)?.length ?? 0) > (core.match(/\(/g)?.length ?? 0)) core = core.slice(0, -1);
  core = core.replace(/[.,;!?]+$/, "");
  const href = normalizeSafeExternalUrl(core);
  return href ? { href, display: core, trailing: raw.slice(core.length) } : null;
}

/** Resolve only real same-origin HTTP(S) paths, never protocol-relative or backslash URLs. */
export function sameOriginPath(value: string, origin: string): string | null {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith("//")
    || (!value.startsWith("/") && !/^https?:\/\//i.test(value))) return null;
  try {
    const url = new URL(value, origin);
    if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(origin).origin || url.username || url.password) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
