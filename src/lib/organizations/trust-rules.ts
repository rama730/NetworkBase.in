// Trust and safety rules (report §30.3), pure so the server and tests agree.
import { REPORT_REASONS as TERMS_REPORT_REASONS } from "@/lib/copy/terms";

export const REPORT_REASONS = ["impersonation", "spam", "harassment", "inappropriate", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
// Decision 41: labels from the one list. "hate_speech" joins once the content_reports check allows it (Phase 10).
export const REPORT_REASON_LABEL = Object.fromEntries(
  REPORT_REASONS.map((id) => [id, TERMS_REPORT_REASONS.find((r) => r.id === id)!.label]),
) as Record<ReportReason, string>;
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
