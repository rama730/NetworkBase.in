import { createHmac, timingSafeEqual } from "node:crypto";

import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { escapeHtml, renderEmailShell, renderPonytailAvatar, type EmailPayload, type OrgEmailKind } from "./contracts";

// Organization emails E1–E14 (report §26.5). One table of parts per kind, one shell for all of them.
// The data is frozen at queue time and already filtered for the recipient: only files they can open,
// no one else's status, only their own team.

/** Access, ownership and account emails: they skip the email switch and org mutes, not bounce blocking. */
export const ALWAYS_SENT_EMAILS: ReadonlySet<OrgEmailKind> = new Set(["org_ready", "org_invite_signup", "org_removed", "org_ownership", "org_deleted"]);

export type OrgEmailPerson = { id: string; name: string; username?: string | null; avatarUrl?: string | null; headline?: string | null };

export type OrgEmailData = {
  /** `type` is the label people read ("Education", or Other's own label). */
  org: { id: string; title: string; slug: string | null; type?: string | null; logoUrl?: string | null; tagline?: string | null };
  child?: { title: string } | null;
  actor?: OrgEmailPerson | null;
  joinCode?: string | null;
  role?: string | null;
  memberTitle?: string | null;
  expiresAt?: string | null;
  note?: string | null;
  reason?: string | null;
  pinnedDocs?: string[];
  assignment?: {
    title: string; copyId?: string | null; dueAt?: string | null; description?: string | null; steps?: string[];
    materials?: Array<{ name: string; size?: number | null }>; team?: string[]; teamName?: string | null;
    reviewRequired?: boolean; submission?: string | null; group?: boolean; lateUntil?: string | null; version?: number | null;
  } | null;
  items?: Array<{ title: string; dueAt: string | null; status: string }>;
  post?: { id: string; content: string } | null;
  digest?: { toReview: Array<{ title: string; count: number }>; joinRequests: number; needsYou: string[]; behind: number } | null;
  previousOwner?: boolean;
  personalProjects?: string[];
  timeZone?: string | null;
  orgTimeZone?: string | null;
};

type Link = { label: string; href: string };
type Parts = {
  subject: string;
  preview: string;
  identity: "org" | "actor";
  label: string;
  headline: string;
  paragraphs?: string[];
  pills?: string[];
  quote?: string | null;
  big?: string | null;
  sections?: Array<{ title: string; rows: string[] }>;
  primary: Link;
  secondary?: Link | null;
  reason: string;
};

function oneLine(value: string, max = 160) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

/** "Fri 31 Oct, 11:59 PM" in the recipient's zone, with the org's time in brackets when it differs. */
export function formatEmailWhen(iso: string | null | undefined, timeZone?: string | null, orgTimeZone?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = (tz?: string | null) => {
    try {
      return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz || "UTC" }).format(date).replace(/ (am|pm)$/i, (m) => m.toUpperCase());
    } catch {
      return null;
    }
  };
  const mine = fmt(timeZone) ?? fmt("UTC")!;
  const theirs = orgTimeZone && orgTimeZone !== timeZone ? fmt(orgTimeZone) : null;
  return theirs && theirs !== mine ? `${mine} (${theirs} org time)` : mine;
}

function formatSize(bytes?: number | null) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? ` (${Math.max(1, Math.round(bytes / 1024))} KB)` : ` (${(bytes / 1024 / 1024).toFixed(1)} MB)`;
}

/** Signed one-click "Mute emails from <org>" token: user and org, HMAC with EMAIL_LINK_SECRET. */
export function orgMuteToken(userId: string, orgId: string) {
  const secret = process.env.EMAIL_LINK_SECRET?.trim();
  if (!secret) return null;
  const body = Buffer.from(`${userId}.${orgId}`).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readOrgMuteToken(token: string): { userId: string; orgId: string } | null {
  const secret = process.env.EMAIL_LINK_SECRET?.trim();
  const [body, signature] = token.split(".");
  if (!secret || !body || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [userId, orgId] = Buffer.from(body, "base64url").toString().split(".");
  return userId && orgId ? { userId, orgId } : null;
}

function partsFor(kind: OrgEmailKind, d: OrgEmailData, url: (path: string) => string): Parts {
  const org = d.org.title;
  const orgPath = `/org/${encodeURIComponent(d.org.slug ?? d.org.id)}`;
  const open: Link = { label: `Open ${org} →`, href: url(orgPath) };
  const actor = d.actor?.name ?? "Someone";
  const when = (iso?: string | null) => formatEmailWhen(iso, d.timeZone, d.orgTimeZone);
  const member = `You’re receiving this because you’re a member of ${org}.`;
  const a = d.assignment;
  const copyHref = url(a?.copyId ? `${orgPath}?tab=assignments&copy=${encodeURIComponent(a.copyId)}` : `${orgPath}?tab=assignments`);
  const orgLabel = `ORGANIZATION${d.org.type ? ` · ${d.org.type.toUpperCase()}` : ""}`;

  switch (kind) {
    case "org_ready":
      return {
        subject: `${org} is ready: invite your members`, preview: `Share code ${d.joinCode ?? ""} so people can join ${org}.`,
        identity: "org", label: orgLabel, headline: `${org} is ready`,
        paragraphs: ["People join with this code, or with the invite link."],
        big: d.joinCode ?? null,
        sections: [{ title: "What’s next", rows: ["Share the code or the link", "Plan your sprints", "Add materials to Files"] }],
        primary: open, secondary: d.joinCode ? { label: "Copy invite link", href: url(`/join/${encodeURIComponent(d.joinCode)}`) } : null,
        reason: `You’re receiving this because you created ${org} on NetworkBase.`,
      };
    case "org_invite":
    case "org_invite_signup":
      return {
        subject: kind === "org_invite" ? `${actor} invited you to ${org}` : `${actor} invited you to ${org} on NetworkBase`,
        preview: `${actor} invited you to join ${org}${d.role ? ` as ${d.role}` : ""}.`,
        identity: "actor", label: "INVITED BY", headline: `Join ${org}`,
        paragraphs: [d.org.tagline ?? "", kind === "org_invite_signup" ? "Create your account with this email address and you’ll join automatically." : ""].filter(Boolean),
        pills: [d.role ?? "", d.memberTitle ?? "", d.expiresAt ? `Expires ${when(d.expiresAt)}` : ""].filter(Boolean),
        quote: d.note ?? null,
        primary: kind === "org_invite" ? { label: "Accept invitation →", href: url("/network?tab=invitations") } : { label: "Create your account →", href: url("/signup") },
        secondary: kind === "org_invite" ? { label: "View organization", href: url(orgPath) } : { label: "What is NetworkBase", href: url("/") },
        reason: `You’re receiving this because ${actor} invited this address to ${org}.`,
      };
    case "org_welcome":
      return {
        subject: `You’re in ${org}`, preview: d.note ? oneLine(d.note) : `Welcome to ${org}.`,
        identity: "org", label: "ORGANIZATION", headline: `You’re in ${org}`,
        quote: d.note ?? null,
        sections: d.pinnedDocs?.length ? [{ title: "Pinned docs", rows: d.pinnedDocs }] : [],
        primary: open, secondary: { label: "Add to your profile", href: url("/profile") }, reason: member,
      };
    case "org_assignment": {
      const due = when(a?.dueAt);
      const where = d.child ? `${org.toUpperCase()} → ${d.child.title.toUpperCase()}` : org.toUpperCase();
      return {
        subject: `New assignment: ${a?.title ?? "Assignment"}${due ? ` · due ${due}` : ""}`,
        preview: `${a?.title ?? "Assignment"}${due ? ` — due ${due}` : ""} in ${org}`,
        identity: "actor", label: `ASSIGNMENT · ${where}`, headline: `New assignment: ${a?.title ?? "Assignment"}`,
        paragraphs: a?.description ? [a.description] : [],
        pills: [due ? `Due ${due}` : "", a?.reviewRequired ? "Review required" : "", a?.submission ? `Submit: ${a.submission}` : "", a?.teamName ?? ""].filter(Boolean),
        sections: [
          a?.steps?.length ? { title: `Steps (0 of ${a.steps.length})`, rows: a.steps.map((s, i) => `${i + 1}. ${s}`) } : null,
          a?.materials?.length ? { title: `Materials (${a.materials.length})`, rows: a.materials.map((m) => `${m.name}${formatSize(m.size)}`) } : null,
          a?.team?.length ? { title: "Your team", rows: a.team } : null,
        ].filter((s): s is { title: string; rows: string[] } => Boolean(s)),
        primary: { label: d.child ? "Open assignment →" : "Open assignment →", href: copyHref }, secondary: { label: `View in ${org}`, href: url(`${orgPath}?tab=assignments`) },
        reason: member,
      };
    }
    case "org_due_soon": {
      const items = d.items ?? [];
      return {
        subject: items.length === 1 ? `Due tomorrow: ${items[0]!.title}` : `${items.length} assignments due tomorrow in ${org}`,
        preview: items.map((i) => i.title).join(", "),
        identity: "org", label: "DUE SOON", headline: items.length === 1 ? `${items[0]!.title} is due tomorrow` : `${items.length} assignments are due tomorrow`,
        sections: [{ title: "Due soon", rows: items.map((i) => `${i.title}${i.dueAt ? ` · due ${when(i.dueAt)}` : ""} · ${i.status}`) }],
        primary: { label: "Open my work →", href: url(`${orgPath}?tab=assignments`) }, reason: member,
      };
    }
    case "org_overdue":
      return {
        subject: `${a?.title ?? "Assignment"} is overdue${a?.lateUntil ? `: late work accepted until ${when(a.lateUntil)}` : ""}`,
        preview: `${a?.title ?? "Assignment"} was due ${when(a?.dueAt) ?? "earlier"}.`,
        identity: "org", label: "OVERDUE", headline: `${a?.title ?? "Assignment"} is overdue`,
        pills: [a?.dueAt ? `Was due ${when(a.dueAt)}` : ""].filter(Boolean),
        paragraphs: [a?.lateUntil ? `Late work is accepted until ${when(a.lateUntil)}. Submit what you have.` : "Submit what you have."],
        primary: { label: "Submit now →", href: copyHref }, reason: member,
      };
    case "org_returned":
      return {
        subject: `${a?.title ?? "Your work"} was returned${d.reason ? `: ${oneLine(d.reason, 80)}` : ""}`,
        preview: d.reason ? oneLine(d.reason) : `${actor} returned ${a?.title ?? "your work"}.`,
        identity: "actor", label: "RETURNED BY", headline: `${a?.title ?? "Your work"} was returned`,
        quote: d.reason ?? null, pills: a?.version ? [`v${a.version}`] : [],
        primary: { label: "Open assignment →", href: copyHref }, reason: member,
      };
    case "org_announcement": {
      const content = d.post?.content ?? "";
      const postHref = url(`${orgPath}?tab=updates${d.post ? `&updateId=${encodeURIComponent(d.post.id)}` : ""}`);
      return {
        subject: `${org}: ${oneLine(content, 90) || "New announcement"}`, preview: oneLine(content),
        identity: "actor", label: `ANNOUNCEMENT · ${org.toUpperCase()}`, headline: oneLine(content, 120) || "New announcement",
        paragraphs: content.length > 120 ? [content] : [],
        primary: { label: `Read in ${org} →`, href: postHref }, secondary: { label: "Reply in comments", href: postHref }, reason: member,
      };
    }
    case "org_ended":
      return {
        subject: `${org} has ended`, preview: `${org} is read-only now. Your submissions stay available.`,
        identity: "org", label: "ORGANIZATION", headline: `${org} has ended`,
        paragraphs: ["Everything is read-only now, and your submissions stay available.", "Add this to your contributions."],
        primary: { label: "Update your contribution →", href: url("/profile") }, secondary: open, reason: member,
      };
    case "org_digest": {
      const g = d.digest ?? { toReview: [], joinRequests: 0, needsYou: [], behind: 0 };
      const submissions = g.toReview.reduce((n, r) => n + r.count, 0);
      const summary = [submissions ? `${submissions} submission${submissions === 1 ? "" : "s"}` : "", g.joinRequests ? `${g.joinRequests} join request${g.joinRequests === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
      return {
        subject: `${org} today: ${summary || "things need you"}`, preview: summary || g.needsYou.join(", "),
        identity: "org", label: "DAILY SUMMARY", headline: `${org} today`,
        sections: [
          g.toReview.length ? { title: "To review", rows: g.toReview.map((r) => `${r.title}: ${r.count}`) } : null,
          g.joinRequests ? { title: "Join requests", rows: [`${g.joinRequests} waiting`] } : null,
          g.needsYou.length ? { title: "Needs your attention", rows: g.needsYou } : null,
          g.behind ? { title: "Behind", rows: [`${g.behind} ${g.behind === 1 ? "person has" : "people have"} missing work`] } : null,
        ].filter((s): s is { title: string; rows: string[] } => Boolean(s)),
        primary: { label: "Open review queue →", href: url(`${orgPath}?tab=assignments&view=review`) }, secondary: { label: "Open overview", href: url(orgPath) },
        reason: `You’re receiving this daily summary as an admin of ${org}.`,
      };
    }
    case "org_removed":
      return {
        subject: `You were removed from ${org}`, preview: d.reason ? oneLine(d.reason) : `You’re no longer a member of ${org}.`,
        identity: "org", label: "ORGANIZATION", headline: `You were removed from ${org}`,
        quote: d.reason ?? null,
        paragraphs: ["Your profile entry stays. Your submissions remain with the organization."],
        primary: { label: "View your profile", href: url("/profile") }, secondary: { label: "Contact support", href: "mailto:support@networkbase.in" },
        reason: `You’re receiving this because you were a member of ${org}.`,
      };
    case "org_ownership":
      return {
        subject: d.previousOwner ? `You transferred ${org} to ${actor}` : `You’re now the owner of ${org}`,
        preview: d.previousOwner ? `${actor} owns ${org} now.` : `You own ${org} now.`,
        identity: "org", label: "OWNERSHIP", headline: d.previousOwner ? `${actor} owns ${org} now` : `You’re now the owner of ${org}`,
        paragraphs: d.previousOwner ? ["You stay an admin unless the new owner changes that."] : ["Owners manage admins, the organization’s name and picture, and can archive or delete it."],
        primary: { label: "Open settings →", href: url(`${orgPath}?tab=settings`) },
        reason: `You’re receiving this because ownership of ${org} changed.`,
      };
    case "org_deleted":
      return {
        subject: `${org} was deleted`, preview: `${org} was deleted.`,
        identity: "org", label: "ORGANIZATION", headline: `${org} was deleted`,
        paragraphs: ["Work you did in your own workspaces is still yours."],
        sections: d.personalProjects?.length ? [{ title: "Now your personal workspaces", rows: d.personalProjects }] : [],
        primary: { label: "Open my workspaces", href: url("/projects") },
        reason: `You’re receiving this because you were a member of ${org}.`,
      };
  }
}

const PILL = "display:inline-block;padding:4px 9px;background:#F3F4F6;color:#374151;border-radius:4px;font-size:11px;font-weight:600;margin:0 6px 6px 0;";
const MICRO = "font-size:11px;font-weight:700;letter-spacing:0.05em;color:#6B7280;text-transform:uppercase;margin-bottom:12px;";

function button(link: Link, primary: boolean, last: boolean) {
  const style = primary
    ? "display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-color:#C24720;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;"
    : "display:inline-block;padding:8px 16px;font-size:13px;font-weight:600;color:#374151;background-color:#FFFFFF;border:1px solid #D1D5DB;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;";
  return `                  <td class="action-btn-cell" style="padding:${last ? "0" : "0 8px 0 0"};vertical-align:middle;">
                    <a href="${escapeHtml(link.href)}" class="action-btn" style="${style}">${escapeHtml(link.label)}</a>
                  </td>`;
}

/** Builds one org email for one recipient. `muteUrl` is the signed one-click link, when there is one. */
export function buildOrgEmail(kind: OrgEmailKind, data: OrgEmailData, input: { email: string; muteUrl?: string | null }): EmailPayload {
  const origin = resolveAuthBaseUrl();
  const url = (path: string) => new URL(path, origin).toString();
  const p = partsFor(kind, data, url);
  const settingsUrl = url("/settings#settings-notifications");
  const who = p.identity === "actor" && data.actor
    ? { avatarHtml: renderPonytailAvatar({ avatarUrl: data.actor.avatarUrl, displayName: data.actor.name, username: data.actor.username, identityKey: data.actor.id }), name: data.actor.name, handle: data.actor.username ?? null, subHtml: data.actor.headline ? `<span>${escapeHtml(data.actor.headline)}</span>` : null }
    : { avatarHtml: renderPonytailAvatar({ avatarUrl: data.org.logoUrl, displayName: data.org.title, identityKey: data.org.id }), name: data.child ? `${data.org.title} / ${data.child.title}` : data.org.title, handle: null, subHtml: null };
  const muteLabel = `Mute emails from ${data.org.title}`;
  const mute = ALWAYS_SENT_EMAILS.has(kind) ? null : input.muteUrl ?? null;

  const html = renderEmailShell({
    title: p.subject,
    preview: p.preview,
    crumb: { label: data.org.title, href: url(`/org/${encodeURIComponent(data.org.slug ?? data.org.id)}`) },
    identity: { ...who, label: p.label },
    contentHtml: `          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;">${escapeHtml(p.headline)}</h1>
              ${p.pills?.length ? `<div style="margin:12px 0 0 0;">${p.pills.map((x) => `<span style="${PILL}">${escapeHtml(x)}</span>`).join("")}</div>` : ""}
              ${(p.paragraphs ?? []).map((x) => `<p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#4B5563;white-space:pre-wrap;">${escapeHtml(x)}</p>`).join("")}
              ${p.big ? `<div style="margin:18px 0 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:0.12em;color:#141A1E;">${escapeHtml(p.big)}</div>` : ""}
              ${p.quote ? `<blockquote style="margin:16px 0 0 0;padding:4px 0 4px 12px;border-left:3px solid #E5E7EB;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${escapeHtml(p.quote)}</blockquote>` : ""}
            </td>
          </tr>${(p.sections ?? []).map((s) => `
          <tr><td><div style="margin:24px 0 0 0;padding-top:20px;border-top:1px solid #E5E7EB;"><div style="${MICRO}">${escapeHtml(s.title)}</div>${s.rows.map((r) => `<div style="margin:8px 0;font-size:14px;color:#1F2937;">${escapeHtml(r)}</div>`).join("")}</div></td></tr>`).join("")}`,
    buttonsHtml: [button(p.primary, true, !p.secondary), p.secondary ? button(p.secondary, false, true) : ""].filter(Boolean).join("\n"),
    footer: { reasonHtml: escapeHtml(p.reason), settingsUrl, muteUrl: mute, muteLabel },
  });

  const text = [
    p.headline, "",
    ...(p.pills?.length ? [p.pills.join(" · "), ""] : []),
    ...(p.paragraphs ?? []).flatMap((x) => [x, ""]),
    ...(p.big ? [p.big, ""] : []),
    ...(p.quote ? [`"${p.quote}"`, ""] : []),
    ...(p.sections ?? []).flatMap((s) => [s.title.toUpperCase(), ...s.rows.map((r) => `  ${r}`), ""]),
    `${p.primary.label}: ${p.primary.href}`,
    ...(p.secondary ? [`${p.secondary.label}: ${p.secondary.href}`] : []),
    "", p.reason, `Notification settings: ${settingsUrl}`, ...(mute ? [`${muteLabel}: ${mute}`] : []),
    "Contact Support: mailto:support@networkbase.in", `Privacy: ${url("/privacy")}`, `Security: ${url("/security-reporting")}`, `Terms and Conditions: ${url("/terms")}`,
    "NetworkBase™ · All rights reserved",
  ].join("\n");

  return {
    from: "NetworkBase <notifications@networkbase.in>",
    to: [input.email],
    reply_to: "support@networkbase.in",
    subject: oneLine(p.subject, 160),
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${mute ?? settingsUrl}>, <mailto:support@networkbase.in?subject=unsubscribe>`,
      // One-click only where the link is the signed mute endpoint, which accepts POST.
      ...(mute ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
    },
  };
}
