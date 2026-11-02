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
 * When a badge is rechecked (report §27.9): the website moving off the verified domain removes ✓; a rename keeps a
 * domain badge and sends a staff-given one back to Requested; a transfer changes nothing.
 */
export function recheckVerification(org: { verified: boolean; domain: string | null }, change: { websites?: string[]; renamed?: boolean }): "keep" | "remove" | "request_again" {
  if (!org.verified) return "keep";
  if (org.domain && change.websites && !websiteStillOnDomain(org.domain, change.websites)) return "remove";
  if (!org.domain && change.renamed) return "request_again";
  return "keep";
}
