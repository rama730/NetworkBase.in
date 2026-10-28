// Trust and safety rules (report §30.3), pure so the server and tests agree.

export const REPORT_REASONS = ["impersonation", "spam", "harassment", "inappropriate", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  impersonation: "Impersonation",
  spam: "Spam",
  harassment: "Harassment",
  inappropriate: "Inappropriate content",
  other: "Something else",
};
export type ReportTargetKind = "project" | "update" | "update_comment" | "doc" | "task_comment";

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
