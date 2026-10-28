import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { escapeHtml, renderEmailShell, renderPonytailAvatar, type EmailPayload, type SecurityEmailKind } from "./contracts";

// Account-security emails: about the account itself, so they skip the email switch and mutes (like the org
// "access" emails) and carry no unsubscribe header. The data is frozen at queue time and holds no secrets.

export type SecurityEmailData = {
  /** When it happened (ISO). */
  at?: string | null;
  /** What exactly changed, in a few words: "added", "removed", "regenerated", a token label. */
  detail?: string | null;
  /** Scheduled deletion: when the account is permanently removed (ISO). */
  hardDeleteAt?: string | null;
  /** A reminder: days left before it happens. */
  daysLeft?: number | null;
};

type Person = { email: string; name: string; username?: string | null; avatarUrl?: string | null; userId?: string | null };
type Link = { label: string; href: string };
type Parts = { subject: string; preview: string; label: string; headline: string; paragraphs: string[]; primary: Link; secondary?: Link | null };

export const SECURITY_EMAIL_KINDS: readonly SecurityEmailKind[] = [
  "security_password_changed", "security_mfa_changed", "security_token_created", "security_sessions_revoked", "security_sign_in_method_changed",
  "account_deletion_scheduled", "account_deletion_cancelled", "account_deletion_reminder", "account_deletion_completed",
];
export const isSecurityEmailKind = (kind: string): kind is SecurityEmailKind => (SECURITY_EMAIL_KINDS as readonly string[]).includes(kind);

/** Deletion emails go to an account that is already hidden, so they are the one kind sent to a deactivated profile. */
export const isDeletionEmailKind = (kind: string) => kind.startsWith("account_deletion_");

const formatDate = (value: string | null | undefined) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) + " (UTC)" : null;
};
const formatMoment = (value: string | null | undefined) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : null;
};
const oneLine = (value: string, max = 120) => value.replace(/[\r\n]+/g, " ").trim().slice(0, max);

function partsFor(kind: SecurityEmailKind, data: SecurityEmailData, url: (path: string) => string): Parts {
  const when = formatMoment(data.at);
  const review: Link = { label: "Review account security", href: url("/settings#settings-security") };
  // "This wasn't me": the two things that take an attacker out, in the order to do them.
  const notMe: Link = { label: "This wasn't me", href: url("/settings#settings-security-sessions") };
  const notMeLine = "If this wasn't you, sign out your other devices, change your password again, and write to support@networkbase.in.";
  switch (kind) {
    case "security_password_changed":
      return {
        subject: "Your NetworkBase password was changed", preview: "Your password changed. If this wasn't you, act now.", label: "ACCOUNT SECURITY",
        headline: "Your password was changed",
        paragraphs: [`${when ? `On ${when}, the` : "The"} password for your NetworkBase account was changed. Your editor tokens were signed out, so reconnect your editor when you next use it.`, notMeLine],
        primary: review, secondary: notMe,
      };
    case "security_mfa_changed": {
      const change = data.detail === "removed" ? "An authenticator app was removed from" : data.detail === "regenerated" ? "Your recovery codes were regenerated for" : "An authenticator app was added to";
      return {
        subject: "Sign-in protection changed on your NetworkBase account", preview: `${change} your account.`, label: "ACCOUNT SECURITY",
        headline: data.detail === "removed" ? "An authenticator app was removed" : data.detail === "regenerated" ? "Your recovery codes were regenerated" : "An authenticator app was added",
        paragraphs: [`${when ? `On ${when}: ` : ""}${change} your account. ${data.detail === "regenerated" ? "Older recovery codes no longer work." : ""}`.trim(), notMeLine],
        primary: review, secondary: notMe,
      };
    }
    case "security_token_created":
      return {
        subject: "A new editor token was created", preview: "A token that signs in to your account from an editor was created.", label: "ACCOUNT SECURITY",
        headline: "A new editor token was created",
        paragraphs: [`${when ? `On ${when}, a` : "A"} manual editor token${data.detail ? ` (“${oneLine(data.detail, 80)}”)` : ""} was created. It signs in to your account from an editor for a year, until you revoke it.`, "If you didn't create it, revoke it in Settings > Integrations, then change your password."],
        primary: { label: "Review editor connections", href: url("/settings#settings-integrations-editors") }, secondary: notMe,
      };
    case "security_sign_in_method_changed":
      return {
        subject: "A sign-in method was changed on your NetworkBase account", preview: data.detail ?? "A way to sign in to your account changed.", label: "ACCOUNT SECURITY",
        headline: "A sign-in method was changed",
        paragraphs: [`${when ? `On ${when}: ` : ""}${oneLine(data.detail ?? "A sign-in method was changed", 120)}.`, notMeLine],
        primary: review, secondary: notMe,
      };
    case "security_sessions_revoked": {
      const count = Number(data.detail);
      return {
        subject: "Your other devices were signed out", preview: "Every other device was signed out of your NetworkBase account.", label: "ACCOUNT SECURITY",
        headline: "Your other devices were signed out",
        paragraphs: [`${when ? `On ${when}, ` : ""}${Number.isFinite(count) && count > 0 ? `${count} other session${count === 1 ? " was" : "s were"}` : "Your other sessions were"} signed out, and editor tokens were revoked. You are still signed in here.`, notMeLine],
        primary: review, secondary: notMe,
      };
    }
    case "account_deletion_scheduled": {
      const date = formatDate(data.hardDeleteAt);
      return {
        subject: "Your NetworkBase account is scheduled for deletion", preview: date ? `It will be permanently deleted on ${date}.` : "You can cancel before it is deleted.", label: "ACCOUNT DELETION",
        headline: date ? `Your account will be deleted on ${date}` : "Your account is scheduled for deletion",
        paragraphs: ["Your profile is hidden and you were signed out everywhere. Nothing has been permanently removed yet.", "Changed your mind? Sign in before that date and choose Reactivate account. If you didn't ask for this, sign in now to cancel it, then change your password."],
        primary: { label: "Cancel deletion", href: url(`/login?redirect=${encodeURIComponent("/settings#settings-delete-account")}`) },
      };
    }
    case "account_deletion_completed":
      return {
        subject: "Your NetworkBase account was deleted", preview: "Your account and its data have been permanently deleted.", label: "ACCOUNT DELETION",
        headline: "Your account was deleted",
        paragraphs: ["Your NetworkBase account and its data have been permanently deleted, as you asked. This is the last email you will get about it.", "We keep only your email address and username for 180 days, so they can’t be taken over, and then remove them. If you didn’t ask for this, write to support@networkbase.in."],
        primary: { label: "Contact support", href: url("/support") },
      };
    case "account_deletion_cancelled":
      return {
        subject: "Your NetworkBase account was reactivated", preview: "Deletion was cancelled and your profile is visible again.", label: "ACCOUNT DELETION",
        headline: "Your account was reactivated",
        paragraphs: [`${when ? `On ${when}, deletion` : "Deletion"} was cancelled and your profile is visible again.`, "If you didn't do this, change your password and review your sign-in activity."],
        primary: review,
      };
    case "account_deletion_reminder": {
      const date = formatDate(data.hardDeleteAt);
      const days = data.daysLeft ?? 0;
      return {
        subject: days <= 1 ? "Your NetworkBase account is deleted tomorrow" : `Your NetworkBase account is deleted in ${days} days`, preview: date ? `Permanent deletion on ${date}.` : "Sign in to cancel.", label: "ACCOUNT DELETION",
        headline: days <= 1 ? "Your account is deleted tomorrow" : `Your account is deleted in ${days} days`,
        paragraphs: [`${date ? `On ${date}, your` : "Your"} account and its data will be permanently deleted. After that it cannot be recovered.`, "To keep it, sign in and choose Reactivate account."],
        primary: { label: "Keep my account", href: url(`/login?redirect=${encodeURIComponent("/settings#settings-delete-account")}`) },
      };
    }
  }
}

function button(link: Link, primary: boolean, last: boolean) {
  const style = primary
    ? "display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-color:#C24720;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;"
    : "display:inline-block;padding:8px 16px;font-size:13px;font-weight:600;color:#374151;background-color:#FFFFFF;border:1px solid #D1D5DB;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;";
  return `                  <td class="action-btn-cell" style="padding:${last ? "0" : "0 8px 0 0"};vertical-align:middle;">
                    <a href="${escapeHtml(link.href)}" class="action-btn" style="${style}">${escapeHtml(link.label)}</a>
                  </td>`;
}

export function buildSecurityEmail(kind: SecurityEmailKind, data: SecurityEmailData, person: Person): EmailPayload {
  const origin = resolveAuthBaseUrl();
  const url = (path: string) => new URL(path, origin).toString();
  const p = partsFor(kind, data, url);
  const settingsUrl = url("/settings#settings-notifications");
  const html = renderEmailShell({
    title: p.subject,
    preview: p.preview,
    identity: {
      avatarHtml: renderPonytailAvatar({ avatarUrl: person.avatarUrl, displayName: person.name, username: person.username, identityKey: person.userId || person.username || person.name }),
      label: p.label, name: person.name, handle: person.username ?? null, subHtml: null,
    },
    contentHtml: `          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;">${escapeHtml(p.headline)}</h1>
              ${p.paragraphs.map((x) => `<p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#4B5563;">${escapeHtml(x)}</p>`).join("")}
            </td>
          </tr>`,
    buttonsHtml: [button(p.primary, true, !p.secondary), p.secondary ? button(p.secondary, false, true) : ""].filter(Boolean).join("\n"),
    footer: { reasonHtml: "You are getting this because it is about the security of your NetworkBase account, so it can’t be turned off.", settingsUrl },
  });
  const text = [
    p.headline, "", ...p.paragraphs.flatMap((x) => [x, ""]),
    `${p.primary.label}: ${p.primary.href}`, ...(p.secondary ? [`${p.secondary.label}: ${p.secondary.href}`] : []),
    "", "You are getting this because it is about the security of your NetworkBase account, so it can’t be turned off.",
    "Contact Support: mailto:support@networkbase.in", `Privacy: ${url("/privacy")}`, `Security: ${url("/security-reporting")}`, `Terms and Conditions: ${url("/terms")}`,
    "NetworkBase™ · All rights reserved",
  ].join("\n");
  return { from: "NetworkBase <notifications@networkbase.in>", to: [person.email], reply_to: "support@networkbase.in", subject: oneLine(p.subject, 160), text, html };
}
