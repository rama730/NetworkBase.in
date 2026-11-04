// Trust and safety rules (report §30.3), pure so the server and tests agree.
// The reasons, kinds and labels moved to lib/trust/rules (docs/trust-and-safety-concept.md).
export { REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason, type ReportTargetKind } from "@/lib/trust/rules";

/** Free email providers never verify an org by domain. */
const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "yandex.com", "gmx.com", "mail.com", "rediffmail.com",
]);

function host(url: string) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Automatic Verified badge (report §30.3): the owner's verified email domain matches the org website's domain
 * (either may be a subdomain of the other), and it isn't a free email provider. Returns the matched domain.
 */
export function verificationDomain(ownerEmail: string | null | undefined, websites: string[]): string | null {
  const emailDomain = ownerEmail?.split("@")[1]?.trim().toLowerCase();
  if (!emailDomain || FREE_EMAIL.has(emailDomain)) return null;
  for (const url of websites) {
    const site = host(url);
    if (!site || FREE_EMAIL.has(site) || !site.includes(".")) continue;
    if (emailDomain === site || emailDomain.endsWith(`.${site}`) || site.endsWith(`.${emailDomain}`)) return site;
  }
  return null;
}

/** Join spike (report §30.3): 50+ joins in an hour. */
export const JOIN_SPIKE_PER_HOUR = 50;

/** The website addresses saved in a project's links. */
export function linkUrls(links: unknown): string[] {
  if (Array.isArray(links)) return links.map((item) => (item as { url?: unknown })?.url).filter((url): url is string => typeof url === "string");
  return links && typeof links === "object" ? Object.values(links).filter((url): url is string => typeof url === "string") : [];
}

/** Report §27.9: a domain-verified badge holds only while a website in Links is still on that domain. */
export function websiteStillOnDomain(domain: string, websites: string[]) {
  return websites.some((url) => {
    const site = host(url);
    return Boolean(site && (site === domain || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`)));
  });
}

export type VerificationOutcome = { state: "declined" | "removed"; reason: string | null; at: string };

/**
 * The ways a badge is earned (2026-11-05-org-address-discovery-verification-findings.md §5). `owner_email` is the
 * original automatic way (the owner's email domain matches the website); the others are the four ways in the card.
 */
export type VerificationMethod = "owner_email" | "email" | "parent" | "website" | "github" | "dns" | "team";

/** Methods whose ✓ rests on a website in Links: they go when the website moves off that domain. */
const LINK_METHODS = new Set<VerificationMethod | null>(["owner_email", "website"]);
/** Methods a person or the team judged by name: a rename sends them back to review. */
const NAME_METHODS = new Set<VerificationMethod | null>(["team", "parent", "github"]);

/**
 * When a badge is rechecked (report §27.9, decision 56): a link-based badge goes when the website moves off its
 * domain; a rename keeps a domain badge (email code, DNS, website) and sends a judged one back to review; a transfer
 * changes nothing. Badges from before 0064 have no method: a domain means `owner_email`, none means `team`.
 */
export function recheckVerification(org: { verified: boolean; domain: string | null; method?: VerificationMethod | null }, change: { websites?: string[]; renamed?: boolean }): "keep" | "remove" | "request_again" {
  if (!org.verified) return "keep";
  const method = org.method ?? (org.domain ? "owner_email" : "team");
  if (LINK_METHODS.has(method) && org.domain && change.websites && !websiteStillOnDomain(org.domain, change.websites)) return "remove";
  if (NAME_METHODS.has(method) && change.renamed) return "request_again";
  return "keep";
}

/** D2: what a ✓ was checked against, for its tooltip and About ("Verified · rvce.edu.in"). */
export function verifiedLabel(method: string | null | undefined, against: string | null | undefined) {
  if (against && method !== "team") return `Verified · ${against}`;
  return "Verified by the NetworkBase team";
}

/** Way 1: the domain of a school or work address, or why it can't be used. */
export function verificationEmailDomain(email: string): { domain: string } | { error: string } {
  const value = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { error: "Enter an email address, like name@rvce.edu.in." };
  const domain = value.split("@")[1]!;
  if (FREE_EMAIL.has(domain)) return { error: "Use an address on your organization’s own domain, not Gmail, Outlook or the like." };
  return { domain };
}

/** "r…@rvce.edu.in": enough to recognise the address, not enough to read it off a screen. */
export function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}…@${domain}`;
}

/** Way 1's limits (§7): 10 minutes, 5 tries, 3 sends an hour. */
export const VERIFY_CODE_MINUTES = 10;
export const VERIFY_CODE_TRIES = 5;
export const VERIFY_CODE_SENDS_PER_HOUR = 3;
/** Seconds before Resend is offered again. */
export const VERIFY_CODE_RESEND_SECONDS = 45;

/** Sends inside the last hour, and whether another is allowed now. */
export function codeSendWindow(sends: Date[], now = new Date()) {
  const recent = sends.filter((at) => now.getTime() - at.getTime() < 3_600_000);
  const last = recent.reduce<Date | null>((max, at) => (!max || at > max ? at : max), null);
  const waitSeconds = last ? Math.max(0, VERIFY_CODE_RESEND_SECONDS - Math.floor((now.getTime() - last.getTime()) / 1000)) : 0;
  return { recent, allowed: recent.length < VERIFY_CODE_SENDS_PER_HOUR && waitSeconds === 0, waitSeconds };
}

/** Way 3: whether a page, a GitHub description or a TXT record carries the organization's code. */
export function proofFound(text: string | null | undefined, code: string) {
  return Boolean(text && text.includes(code));
}

/** The GitHub organization a link points at ("acme" from https://github.com/acme or github.com/acme/repo). */
export function githubOrgOf(url: string): string | null {
  const site = host(url);
  if (site !== "github.com") return null;
  try {
    const path = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname.split("/").filter(Boolean);
    return path[0] && /^[a-z0-9-]{1,39}$/i.test(path[0]) ? path[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The websites in Links that aren't GitHub, LinkedIn or the like: where a website code can sit. */
export function ownWebsites(urls: string[]) {
  return urls.filter((url) => {
    const site = host(url);
    return Boolean(site && site.includes(".") && !/(^|\.)(github\.com|linkedin\.com|x\.com|twitter\.com|instagram\.com|facebook\.com|youtube\.com)$/.test(site));
  });
}

export function hostOf(url: string) {
  return host(url);
}
