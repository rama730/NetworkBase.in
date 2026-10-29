import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { escapeHtml, renderEmailShell, renderPonytailAvatar, type EmailPayload } from "./contracts";

// Trust and safety emails (docs/trust-and-safety-concept.md §9): M1–M11 to the person a decision is about, and the
// staff alerts and summaries. The words are composed when the email is queued (lib/trust/messages); this renders them
// in the shared shell. From notifications@, Reply-To support@, the case number in the subject (T17).

export type TrustEmailKind = "trust_person" | "trust_staff";
export const TRUST_EMAIL_KINDS: readonly TrustEmailKind[] = ["trust_person", "trust_staff"];
export const isTrustEmailKind = (kind: string): kind is TrustEmailKind => (TRUST_EMAIL_KINDS as readonly string[]).includes(kind);

type Link = { label: string; href: string };
export type TrustEmailData = {
  subject: string;
  preview: string;
  label: string;
  headline: string;
  paragraphs: string[];
  /** Short bullet lines, e.g. what changes during a limit. */
  bullets?: string[];
  primary?: Link | null;
  secondary?: Link | null;
  /** A line under the buttons, e.g. "You can appeal until 28 Nov." */
  note?: string | null;
};
type Person = { email: string; name: string; username?: string | null; avatarUrl?: string | null; userId?: string | null };

function button(link: Link, primary: boolean, last: boolean) {
  const style = primary
    ? "display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-color:#C24720;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;"
    : "display:inline-block;padding:8px 16px;font-size:13px;font-weight:600;color:#374151;background-color:#FFFFFF;border:1px solid #D1D5DB;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;";
  return `                  <td class="action-btn-cell" style="padding:${last ? "0" : "0 8px 0 0"};vertical-align:middle;">
                    <a href="${escapeHtml(link.href)}" class="action-btn" style="${style}">${escapeHtml(link.label)}</a>
                  </td>`;
}

const oneLine = (value: string, max: number) => value.replace(/[\r\n]+/g, " ").trim().slice(0, max);

export function buildTrustEmail(kind: TrustEmailKind, data: TrustEmailData, person: Person): EmailPayload {
  const origin = resolveAuthBaseUrl();
  const abs = (link: Link | null | undefined) => (link ? { label: link.label, href: new URL(link.href, origin).toString() } : null);
  const primary = abs(data.primary);
  const secondary = abs(data.secondary);
  const reason = kind === "trust_staff"
    ? "You are getting this because you are on the NetworkBase trust and safety team."
    : "You are getting this because it is about your NetworkBase account and our rules, so it can’t be turned off. Reply to this email with questions.";
  const html = renderEmailShell({
    title: data.subject,
    preview: data.preview,
    identity: {
      avatarHtml: renderPonytailAvatar({ avatarUrl: person.avatarUrl, displayName: person.name, username: person.username, identityKey: person.userId || person.username || person.name }),
      label: data.label, name: person.name, handle: person.username ?? null, subHtml: null,
    },
    contentHtml: `          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;">${escapeHtml(data.headline)}</h1>
              ${data.paragraphs.map((x) => `<p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#4B5563;">${escapeHtml(x)}</p>`).join("")}
              ${data.bullets?.length ? `<ul style="margin:12px 0 0 0;padding-left:18px;font-size:14px;line-height:1.6;color:#4B5563;">${data.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
              ${data.note ? `<p style="margin:14px 0 0 0;font-size:13px;line-height:1.6;color:#6B7280;">${escapeHtml(data.note)}</p>` : ""}
            </td>
          </tr>`,
    buttonsHtml: [primary ? button(primary, true, !secondary) : "", secondary ? button(secondary, !primary, true) : ""].filter(Boolean).join("\n"),
    footer: { reasonHtml: escapeHtml(reason), settingsUrl: new URL("/settings#settings-account-standing", origin).toString() },
  });
  const text = [
    data.headline, "", ...data.paragraphs.flatMap((x) => [x, ""]), ...(data.bullets ?? []).map((b) => `- ${b}`), ...(data.bullets?.length ? [""] : []),
    ...(data.note ? [data.note, ""] : []),
    ...(primary ? [`${primary.label}: ${primary.href}`] : []), ...(secondary ? [`${secondary.label}: ${secondary.href}`] : []),
    "", reason, "Contact support: mailto:support@networkbase.in", `Rules: ${new URL("/acceptable-use", origin).toString()}`, "© NetworkBase. All rights reserved.",
  ].join("\n");
  return { from: "NetworkBase <notifications@networkbase.in>", to: [person.email], reply_to: "support@networkbase.in", subject: oneLine(data.subject, 160), text, html };
}
