import { z } from "zod";
import { Webhook } from "svix";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { publicAvatarVariantUrl } from "@/lib/profile/avatar-variants";
import { getPersonAvatarTone, type PersonAvatarTone } from "@/lib/ui/avatar";

export type OrgEmailKind =
  | "org_ready" | "org_invite" | "org_invite_signup" | "org_welcome" | "org_assignment" | "org_due_soon" | "org_overdue"
  | "org_returned" | "org_announcement" | "org_ended" | "org_digest" | "org_removed" | "org_ownership" | "org_deleted";
/** Account security and deletion: sent whatever the email setting says (the account itself is at stake). */
export type SecurityEmailKind =
  | "security_password_changed" | "security_mfa_changed" | "security_token_created" | "security_sessions_revoked" | "security_sign_in_method_changed"
  | "account_deletion_scheduled" | "account_deletion_cancelled" | "account_deletion_reminder" | "account_deletion_completed";
export type EmailKind = "welcome" | "task_assignment" | OrgEmailKind | SecurityEmailKind;
export type EmailAttachment = {
  filename: string;
  path?: string;
  content?: string;
  content_id?: string;
  contentId?: string;
  contentType?: string;
};
export type EmailPayload = {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
};
export type EmailDeliveryState = "accepted" | "delivered" | "failed" | "bounced" | "complained";
export const DELIVERY_RANK: Record<EmailDeliveryState, number> = {
  accepted: 0, delivered: 1, failed: 2, bounced: 3, complained: 4,
};
export const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 8;

export function emailEnabled() {
  return process.env.RESEND_EMAIL_ENABLED === "true";
}

export function recipientAllowed(email: string) {
  // Preview/staging Next builds also set NODE_ENV=production. Fail closed there.
  if (process.env.NODE_ENV === "production" && process.env.RAILWAY_ENVIRONMENT_NAME === "production") return true;
  return (process.env.RESEND_TEST_RECIPIENTS ?? "").split(",")
    .some((value) => value.trim().toLowerCase() === email.toLowerCase());
}

export function emailEventKey(kind: EmailKind, eventId: string, userId: string) {
  return `${kind}:${eventId}:${userId}`;
}

export function assignmentRecipient(actorId: string, assigneeId: string | null | undefined, previousId?: string | null) {
  return assigneeId && assigneeId !== actorId && assigneeId !== previousId ? assigneeId : null;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export type EmailSubtask = {
  id?: string;
  title: string;
  completed?: boolean;
  files?: Array<{
    name: string;
    size?: number;
    url?: string;
  }>;
};

export type EmailFileReference = {
  id?: string;
  name: string;
  size?: number;
  url?: string;
  mimeType?: string;
};

export type BuildEmailInput = {
  kind: EmailKind;
  email: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  headline?: string | null;
  skills?: string[] | null;
  userId?: string | null;
  taskTitle?: string;
  projectTitle?: string;
  taskId?: string;
  projectSlug?: string;
  taskNumber?: number | string | null;
  taskDescription?: string | null;
  priority?: "low" | "medium" | "high" | "urgent" | string | null;
  status?: string | null;
  dueDate?: Date | string | null;
  assigneeName?: string | null;
  assigneeUsername?: string | null;
  assigneeAvatarUrl?: string | null;
  assigneeHeadline?: string | null;
  assigneeId?: string | null;
  assignerName?: string | null;
  assignerUsername?: string | null;
  subtasks?: EmailSubtask[];
  files?: EmailFileReference[];
  connectedDesktopIde?: {
    name: string;
    scheme?: string;
    launchUrl?: string;
  } | null;
};

const PONYTAIL_TONE_COLORS: Record<PersonAvatarTone, { bg: string; text: string }> = {
  amber: { bg: "#FEF3C7", text: "#92400E" },
  blue: { bg: "#DBEAFE", text: "#1E40AF" },
  mint: { bg: "#D1FAE5", text: "#065F46" },
  rose: { bg: "#FFE4E6", text: "#9F1239" },
};

function getInitials(name?: string | null, username?: string | null): string {
  const clean = (name || username || "U").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) {
    const fChar = first[0] ?? "";
    const sChar = second[0] ?? "";
    return (fChar + sChar).toUpperCase() || "U";
  }
  return clean.slice(0, 2).toUpperCase() || "U";
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "📄";
    case "xls":
    case "xlsx":
    case "csv": return "📊";
    case "doc":
    case "docx":
    case "txt":
    case "md": return "📝";
    case "zip":
    case "tar":
    case "gz": return "📦";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg": return "🖼";
    case "dwg":
    case "cad": return "📐";
    default: return "📎";
  }
}

function formatDueDate(dueDate?: Date | string | null): { label: string; isUrgent: boolean; isOverdue: boolean } | null {
  if (!dueDate) return null;
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return null;
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

  let label: string;
  let isUrgent = false;
  let isOverdue = false;

  if (diffDays < 0) {
    label = `Overdue (${dateStr})`;
    isOverdue = true;
  } else if (diffDays === 0) {
    label = `Due today (${dateStr})`;
    isUrgent = true;
  } else if (diffDays === 1) {
    label = `Due tomorrow (${dateStr})`;
    isUrgent = true;
  } else if (diffDays <= 7) {
    label = `Due in ${diffDays} days (${dateStr})`;
  } else {
    label = `Due ${dateStr}`;
  }

  return { label, isUrgent, isOverdue };
}

function formatPriority(priority?: string | null): { label: string; color: string; bg: string } | null {
  if (!priority) return null;
  const p = priority.toLowerCase();
  switch (p) {
    case "urgent": return { label: "Urgent", color: "#DC2626", bg: "#FEE2E2" };
    case "high": return { label: "High priority", color: "#EA580C", bg: "#FFEDD5" };
    case "medium": return { label: "Medium", color: "#D97706", bg: "#FEF3C7" };
    case "low": return { label: "Low", color: "#6B7280", bg: "#F3F4F6" };
    default: return { label: priority, color: "#6B7280", bg: "#F3F4F6" };
  }
}

function formatStatus(status?: string | null): string | null {
  if (!status) return null;
  const s = status.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function extractAvatarStoragePath(avatarUrl: string): { bucket: string; path: string } | null {
  try {
    const url = new URL(avatarUrl);
    const match = url.pathname.match(/\/storage\/v1\/(?:object|render\/image)\/public\/([^/]+)\/(.+)$/);
    if (match && match[1] && match[2]) {
      return { bucket: match[1], path: decodeURIComponent(match[2]) };
    }
    return null;
  } catch {
    return null;
  }
}

export function renderPonytailAvatar(params: {
  avatarUrl?: string | null;
  displayName?: string | null;
  username?: string | null;
  identityKey?: string | null;
}): string {
  const name = params.displayName || params.username || "Member";
  const initials = getInitials(params.displayName, params.username);
  const tone = getPersonAvatarTone(params.identityKey || params.username || name);
  const colors = PONYTAIL_TONE_COLORS[tone] ?? { bg: "#FEF3C7", text: "#92400E" };

  if (params.avatarUrl) {
    // Direct HTTPS avatar rendering: 44x44px square with border-radius: 6px.
    // Zero attachments array => zero paperclip icons (📎) or downloadable files in Apple Mail.
    return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;display:inline-table;vertical-align:middle;"><tr><td style="width:44px;height:44px;border-radius:6px;overflow:hidden;background-color:${colors.bg};text-align:center;vertical-align:middle;padding:0;line-height:0;"><img src="${escapeHtml(params.avatarUrl)}" width="44" height="44" alt="${escapeHtml(name)}" style="width:44px;height:44px;border-radius:6px;display:block;object-fit:cover;border:0;outline:none;text-decoration:none;" /></td></tr></table>`;
  }

  // Pure Ponytail initials avatar: deterministic FNV-1a tone palette, 44x44px square badge with border-radius: 6px.
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;display:inline-table;vertical-align:middle;"><tr><td style="width:44px;height:44px;border-radius:6px;background-color:${colors.bg};color:${colors.text};text-align:center;vertical-align:middle;font-size:15px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:44px;padding:0;">${escapeHtml(initials)}</td></tr></table>`;
}

export type EmailShellInput = {
  title: string;
  /** Hidden inbox preview text. */
  preview: string;
  /** "NetworkBase / <project>" crumb in the brand bar. */
  crumb?: { label: string; href: string } | null;
  identity: { avatarHtml: string; label: string; name: string; handle?: string | null; subHtml?: string | null };
  /** Table rows between the identity header and the buttons. */
  contentHtml: string;
  /** Button cells for the action bar. */
  buttonsHtml: string;
  footer: { reasonHtml: string; settingsUrl: string; muteUrl?: string | null; muteLabel?: string | null };
};

/** The one email layout (report §26.5): paper page, brand bar, identity header, content, action bar, footer. */
export function renderEmailShell(input: EmailShellInput) {
  const origin = resolveAuthBaseUrl();
  const supportUrl = "mailto:support@networkbase.in";
  const privacyUrl = new URL("/privacy", origin).toString();
  const securityUrl = new URL("/security-reporting", origin).toString();
  const termsUrl = new URL("/terms", origin).toString();
  const { identity, footer } = input;
  // Ghost padding keeps the body out of the inbox snippet without tripping spam filters.
  const ghostPadding = "&zwnj;&nbsp;".repeat(45);
  const crumbHtml = input.crumb ? `
                    <span style="color:#D1D5DB;margin:0 5px;vertical-align:middle;font-weight:normal;line-height:1;" aria-hidden="true">/</span>
                    <a href="${escapeHtml(input.crumb.href)}" style="color:#4B5563;font-weight:600;font-size:14px;vertical-align:middle;text-decoration:none;line-height:1;">${escapeHtml(input.crumb.label)}</a>` : "";
  const muteHtml = footer.muteUrl
    ? ` <span style="color:#D1D5DB;margin:0 6px;" aria-hidden="true">&bull;</span> <a href="${escapeHtml(footer.muteUrl)}" style="color:#C24720;text-decoration:none;font-weight:500;">${escapeHtml(footer.muteLabel ?? "Mute these emails")}</a>`
    : "";
  return `<!doctype html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(input.title)}</title>
  <!--[if mso]>
  <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  <![endif]-->
  <style>
    @media only screen and (max-width: 520px) {
      .container-cell { padding: 20px 16px !important; }
      .action-bar-table { width: 100% !important; }
      .action-btn-cell { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
      .action-btn { display: block !important; width: 100% !important; text-align: center !important; box-sizing: border-box !important; padding: 11px 16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#FAF8F4;color:#141A1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-align:left;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#FAF8F4;opacity:0;" aria-hidden="true">
    ${escapeHtml(input.preview)}
    ${ghostPadding}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF8F4;width:100%;table-layout:fixed;text-align:left;">
    <tr>
      <td class="container-cell" align="left" style="padding:28px 20px;text-align:left;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="left" style="max-width:600px;width:100%;margin:0 auto;text-align:left;">
          <tr>
            <td style="padding-bottom:16px;border-bottom:1px solid #E5E7EB;text-align:left;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
                <tr>
                  <td style="width:7px;height:7px;vertical-align:middle;padding:0;line-height:0;font-size:0;">
                    <div style="width:7px;height:7px;border-radius:2px;background-color:#C24720;font-size:0;line-height:0;display:block;"></div>
                  </td>
                  <td style="vertical-align:middle;padding:0 0 0 4px;line-height:1;">
                    <span style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#141A1E;vertical-align:middle;line-height:1;display:inline-block;">NetworkBase</span>${crumbHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 0 16px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px;width:44px;">
                    ${identity.avatarHtml}
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#6B7280;text-transform:uppercase;margin-bottom:2px;">
                      ${escapeHtml(identity.label)}
                    </div>
                    <div style="font-size:16px;font-weight:700;color:#111827;line-height:1.2;">
                      ${escapeHtml(identity.name)}
                      ${identity.handle ? `<span style="font-size:13px;font-weight:normal;color:#6B7280;margin-left:4px;">(@${escapeHtml(identity.handle)})</span>` : ""}
                    </div>
                    ${identity.subHtml ? `
                    <div style="font-size:12px;color:#6B7280;margin-top:4px;">
                      ${identity.subHtml}
                    </div>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

${input.contentHtml}

          <tr>
            <td style="padding:28px 0 20px 0;">
              <table class="action-bar-table" role="presentation" cellpadding="0" cellspacing="0" border="0" align="left">
                <tr>
${input.buttonsHtml}
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;border-top:1px solid #E5E7EB;font-size:12px;line-height:1.6;color:#6B7280;text-align:left;">
              <p style="margin:0 0 10px 0;color:#6B7280;">
                ${footer.reasonHtml} <a href="${escapeHtml(footer.settingsUrl)}" style="color:#C24720;text-decoration:none;font-weight:500;">Manage notification preferences</a>${muteHtml}
              </p>
              <div style="margin:0;font-size:12px;color:#6B7280;line-height:1.6;">
                <a href="${escapeHtml(supportUrl)}" style="color:#6B7280;text-decoration:none;">Contact Support</a>
                <span style="color:#D1D5DB;margin:0 6px;" aria-hidden="true">&bull;</span>
                <a href="${escapeHtml(privacyUrl)}" style="color:#6B7280;text-decoration:none;">Privacy</a>
                <span style="color:#D1D5DB;margin:0 6px;" aria-hidden="true">&bull;</span>
                <a href="${escapeHtml(securityUrl)}" style="color:#6B7280;text-decoration:none;">Security</a>
                <span style="color:#D1D5DB;margin:0 6px;" aria-hidden="true">&bull;</span>
                <a href="${escapeHtml(termsUrl)}" style="color:#6B7280;text-decoration:none;">Terms and Conditions</a>
              </div>
              <div style="margin-top:8px;font-size:11px;color:#9CA3AF;">&copy; NetworkBase. All rights reserved.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildEmail(input: BuildEmailInput): EmailPayload {
  const origin = resolveAuthBaseUrl();
  const welcome = input.kind === "welcome";
  if (!welcome && (!input.taskId || !input.projectSlug)) throw new Error("Missing task email context");

  const url = welcome
    ? new URL("/discover", origin).toString()
    : new URL(`/projects/${encodeURIComponent(input.projectSlug!)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(input.taskId!)}`, origin).toString();
  const projectUrl = !welcome && input.projectSlug
    ? new URL(`/projects/${encodeURIComponent(input.projectSlug)}`, origin).toString()
    : url;
  const filesUrl = !welcome && input.projectSlug
    ? new URL(`/projects/${encodeURIComponent(input.projectSlug)}?tab=files`, origin).toString()
    : null;
  const settingsUrl = new URL("/settings#settings-notifications", origin).toString();
  const supportUrl = "mailto:support@networkbase.in";
  const privacyUrl = new URL("/privacy", origin).toString();
  const securityUrl = new URL("/security-reporting", origin).toString();
  const termsUrl = new URL("/terms", origin).toString();

  const title = welcome ? "Welcome to NetworkBase" : "A task has been assigned to you";
  const greeting = `Hi ${input.name || "there"},`;
  const taskTitle = input.taskTitle || "Task";
  const projectTitle = input.projectTitle || "your workspace";
  const button = welcome ? "Explore NetworkBase" : "View task";
  const footer = welcome
    ? "Need help? Reply to this email."
    : `You’re receiving task updates for ${projectTitle} on NetworkBase.`;

  if (welcome) {
    const displayName = input.name || "there";
    const username = input.username || null;
    const headline = input.headline || null;
    const userAvatarHtml = renderPonytailAvatar({
      avatarUrl: input.avatarUrl || input.assigneeAvatarUrl,
      displayName,
      username,
      identityKey: input.userId || username || displayName,
    });

    const profileUrl = username
      ? new URL(`/${encodeURIComponent(username)}`, origin).toString()
      : new URL("/profile", origin).toString();
    const discoverUrl = new URL("/discover", origin).toString();

    // Plain text version
    let welcomeText = `Welcome to NetworkBase, ${displayName}!\n\n`;
    welcomeText += `Your profile is ready.\n`;
    welcomeText += `Name: ${displayName}${username ? ` (@${username})` : ""}${headline ? ` • ${headline}` : ""}\n`;
    if (input.skills && input.skills.length > 0) {
      welcomeText += `Focus and Skills: ${input.skills.join(", ")}\n`;
    }
    welcomeText += `\nExplore workspaces: ${discoverUrl}\n`;
    welcomeText += `View Profile: ${profileUrl}\n\n`;
    welcomeText += `Need help? Reply to this email or visit support: ${supportUrl}\n`;
    welcomeText += `Privacy: ${privacyUrl}\nSecurity: ${securityUrl}\nTerms: ${termsUrl}\n`;
    welcomeText += `\n© NetworkBase. All rights reserved. support@networkbase.in`;

    // Skills pills for HTML
    let skillsHtml = "";
    if (input.skills && input.skills.length > 0) {
      const pills = input.skills.slice(0, 6).map((skill) =>
        `<span style="display:inline-block;padding:4px 9px;background:#F3F4F6;color:#374151;border-radius:4px;font-size:11px;font-weight:500;margin:0 6px 6px 0;white-space:nowrap;">${escapeHtml(skill)}</span>`
      ).join("");
      skillsHtml = `<div style="margin:16px 0 0 0;"><div style="font-size:11px;font-weight:700;letter-spacing:0.05em;color:#6B7280;text-transform:uppercase;margin-bottom:8px;">Focus and Skills</div>${pills}</div>`;
    }

    const previewSnippet = `Welcome to NetworkBase, ${displayName} — Your profile is live. Find people, join workspaces and manage your work in one place.`;

    return {
      from: "NetworkBase <welcome@networkbase.in>",
      to: [input.email],
      reply_to: "support@networkbase.in",
      subject: `Welcome to NetworkBase, ${displayName.replace(/[\r\n]/g, " ").slice(0, 80)}`,
      text: welcomeText,
      headers: {
        // No one-click POST header: there is no endpoint that unsubscribes on POST, and claiming one makes mail apps POST a page.
        "List-Unsubscribe": `<${settingsUrl}>, <mailto:support@networkbase.in?subject=unsubscribe>`,
      },
      html: renderEmailShell({
        title: "Welcome to NetworkBase",
        preview: previewSnippet,
        identity: {
          avatarHtml: userAvatarHtml, label: "Member profile", name: displayName, handle: username,
          subHtml: headline ? `<span>${escapeHtml(headline)}</span>` : null,
        },
        contentHtml: `          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;">
                Welcome to NetworkBase
              </h1>
              <p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#4B5563;">
                Your profile is live. Find people, join workspaces and manage your work in one place.
              </p>
              ${skillsHtml}
            </td>
          </tr>`,
        buttonsHtml: `                  <td class="action-btn-cell" style="padding:0 8px 0 0;vertical-align:middle;">
                    <a href="${escapeHtml(discoverUrl)}" class="action-btn" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-color:#C24720;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;">
                      Explore workspaces &rarr;
                    </a>
                  </td>
                  <td class="action-btn-cell" style="padding:0;vertical-align:middle;">
                    <a href="${escapeHtml(profileUrl)}" class="action-btn" style="display:inline-block;padding:8px 16px;font-size:13px;font-weight:600;color:#374151;background-color:#FFFFFF;border:1px solid #D1D5DB;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;">
                      View Your Profile &#8599;
                    </a>
                  </td>`,
        footer: { reasonHtml: "You’re receiving this email because you created an account on NetworkBase.", settingsUrl },
      }),
    };
  }

  // --- Task Assignment Context ---
  // The assigned person's profile (assignee), explicitly decoupled from the recipient
  const assigneeDisplayName = input.assigneeName || input.name || "Member";
  const assigneeUsername = input.assigneeUsername || null;
  const assigneeHeadline = input.assigneeHeadline || null;
  const assignerDisplayName = input.assignerName || null;
  const assignerUsername = input.assignerUsername || null;
  const assignerText = assignerDisplayName
    ? `Assigned by ${assignerDisplayName}${assignerUsername ? ` (@${assignerUsername})` : ""}`
    : null;

  const assigneeAvatarHtml = renderPonytailAvatar({
    avatarUrl: input.assigneeAvatarUrl,
    displayName: assigneeDisplayName,
    username: assigneeUsername,
    identityKey: input.assigneeId || assigneeUsername || assigneeDisplayName,
  });

  const subtasks = input.subtasks || [];
  const completedSubtasks = subtasks.filter((s) => s.completed).length;
  const files = input.files || [];
  const priorityInfo = formatPriority(input.priority);
  const statusInfo = formatStatus(input.status);
  const dueInfo = formatDueDate(input.dueDate);
  const taskNumberTag = input.taskNumber ? `NB-${input.taskNumber}` : null;

  const desktopIdeLaunchUrl = input.connectedDesktopIde?.launchUrl ?? (
    input.connectedDesktopIde && input.taskId && input.projectSlug
      ? new URL(
          `/open/ide?projectId=${encodeURIComponent(input.projectSlug)}&slug=${encodeURIComponent(input.projectSlug)}&taskId=${encodeURIComponent(input.taskId)}&ide=${encodeURIComponent(input.connectedDesktopIde.scheme || "cursor")}`,
          origin,
        ).toString()
      : null
  );

  // Build Plain Text Version
  let text = `${title}\n\n`;
  text += `Workspace: ${projectTitle}\n`;
  text += `Assigned to: ${assigneeDisplayName}${assigneeUsername ? ` (@${assigneeUsername})` : ""}${assigneeHeadline ? ` • ${assigneeHeadline}` : ""}\n`;
  if (assignerText) text += `${assignerText}\n`;
  text += `\nTask: ${taskTitle}${taskNumberTag ? ` (${taskNumberTag})` : ""}\n`;
  if (priorityInfo) text += `Priority: ${priorityInfo.label}\n`;
  if (statusInfo) text += `Status: ${statusInfo}\n`;
  if (dueInfo) text += `Due: ${dueInfo.label}\n`;
  if (input.taskDescription) text += `\nDescription:\n${input.taskDescription}\n`;

  if (subtasks.length > 0) {
    text += `\nSubtasks (${completedSubtasks} of ${subtasks.length} completed):\n`;
    subtasks.forEach((st, idx) => {
      text += `  ${st.completed ? "[✓]" : "[ ]"} ${idx + 1}. ${st.title}\n`;
      if (st.files && st.files.length > 0) {
        st.files.forEach((file) => {
          text += `      └─ ${file.name}${file.size ? ` (${formatFileSize(file.size)})` : ""}${file.url ? `: ${file.url}` : ""}\n`;
        });
      }
    });
  }

  if (files.length > 0) {
    text += `\nReferenced Files and Assets (${files.length}):\n`;
    files.forEach((f) => {
      text += `  • ${f.name}${f.size ? ` (${formatFileSize(f.size)})` : ""}${f.url ? `: ${f.url}` : ""}\n`;
    });
  }

  text += `\nView Task: ${url}\n`;
  text += `Workspace: ${projectUrl}\n`;
  if (desktopIdeLaunchUrl) {
    text += `Open in ${input.connectedDesktopIde?.name || "Code editor"}: ${desktopIdeLaunchUrl}\n`;
  }
  text += `\n${footer}\nNotification settings: ${settingsUrl}\nContact Support: ${supportUrl}\nPrivacy: ${privacyUrl}\nSecurity: ${securityUrl}\nTerms and Conditions: ${termsUrl}\n© NetworkBase. All rights reserved.`;

  // Build HTML Version (Open Flow Canvas, Zero Boxes, Ponytail Avatar, Subtasks & File References)
  let subtasksHtml = "";
  if (subtasks.length > 0) {
    const subtaskItems = subtasks.map((st, idx) => {
      const isDone = Boolean(st.completed);
      const mark = isDone
        ? `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:#D1FAE5;color:#065F46;font-size:11px;font-weight:bold;margin-right:8px;vertical-align:middle;">✓</span>`
        : `<span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;border:1.5px solid #9CA3AF;color:transparent;font-size:10px;margin-right:8px;vertical-align:middle;">&nbsp;</span>`;

      const titleStyle = isDone
        ? `font-size:14px;color:#6B7280;text-decoration:line-through;vertical-align:middle;`
        : `font-size:14px;color:#1F2937;font-weight:500;vertical-align:middle;`;

      let nestedFilesHtml = "";
      if (st.files && st.files.length > 0) {
        const fileLinks = st.files.map((f) => {
          const fileIcon = getFileIcon(f.name);
          const sizeStr = formatFileSize(f.size);
          const nameHtml = f.url
            ? `<a href="${escapeHtml(f.url)}" style="color:#C24720;text-decoration:none;font-weight:500;">${escapeHtml(f.name)}</a>`
            : `<span style="color:#4B5563;font-weight:500;">${escapeHtml(f.name)}</span>`;
          return `<div style="margin:4px 0 0 28px;font-size:12px;color:#6B7280;"><span aria-hidden="true">${fileIcon}</span> ${nameHtml}${sizeStr ? ` <span style="color:#9CA3AF;">(${sizeStr})</span>` : ""}</div>`;
        }).join("");
        nestedFilesHtml = fileLinks;
      }

      return `<div style="margin:10px 0;"><div>${mark}<span style="${titleStyle}">${idx + 1}. ${escapeHtml(st.title)}</span></div>${nestedFilesHtml}</div>`;
    }).join("");

    subtasksHtml = `
      <div style="margin:28px 0 0 0;padding-top:20px;border-top:1px solid #E5E7EB;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;color:#6B7280;text-transform:uppercase;margin-bottom:12px;">
          Subtasks and Scope <span style="font-weight:normal;color:#9CA3AF;">(${completedSubtasks} of ${subtasks.length} completed)</span>
        </div>
        ${subtaskItems}
      </div>
    `;
  }

  let filesHtml = "";
  if (files.length > 0) {
    const fileItems = files.map((f) => {
      const fileIcon = getFileIcon(f.name);
      const sizeStr = formatFileSize(f.size);
      const linkHtml = f.url
        ? `<a href="${escapeHtml(f.url)}" style="color:#C24720;text-decoration:none;font-weight:500;">${escapeHtml(f.name)}</a>`
        : `<span style="color:#1F2937;font-weight:500;">${escapeHtml(f.name)}</span>`;
      return `
        <div style="display:table;width:100%;margin:8px 0;font-size:13px;">
          <div style="display:table-cell;vertical-align:middle;">
            <span aria-hidden="true" style="margin-right:6px;">${fileIcon}</span> ${linkHtml}
            ${sizeStr ? `<span style="color:#9CA3AF;margin-left:6px;font-size:12px;">(${sizeStr})</span>` : ""}
          </div>
          ${f.url ? `<div style="display:table-cell;text-align:right;vertical-align:middle;font-size:12px;"><a href="${escapeHtml(f.url)}" style="color:#C24720;text-decoration:none;">View →</a></div>` : ""}
        </div>
      `;
    }).join("");

    filesHtml = `
      <div style="margin:24px 0 0 0;padding-top:20px;border-top:1px solid #E5E7EB;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;color:#6B7280;text-transform:uppercase;margin-bottom:12px;">
          Referenced Files and Assets <span style="font-weight:normal;color:#9CA3AF;">(${files.length})</span>
        </div>
        ${fileItems}
      </div>
    `;
  }

  // Badges row: Priority, Status, Due date
  const metaPills: string[] = [];
  if (taskNumberTag) {
    metaPills.push(`<span style="display:inline-block;padding:4px 9px;background:#F3F4F6;color:#374151;border-radius:4px;font-size:11px;font-weight:600;margin-right:6px;">${escapeHtml(taskNumberTag)}</span>`);
  }
  if (priorityInfo) {
    metaPills.push(`<span style="display:inline-block;padding:4px 9px;background:${priorityInfo.bg};color:${priorityInfo.color};border-radius:4px;font-size:11px;font-weight:600;margin-right:6px;">${escapeHtml(priorityInfo.label)}</span>`);
  }
  if (statusInfo) {
    metaPills.push(`<span style="display:inline-block;padding:4px 9px;background:#F3F4F6;color:#4B5563;border-radius:4px;font-size:11px;font-weight:500;margin-right:6px;">${escapeHtml(statusInfo)}</span>`);
  }
  if (dueInfo) {
    const dueBg = dueInfo.isOverdue ? "#FEE2E2" : dueInfo.isUrgent ? "#FEF3C7" : "#F3F4F6";
    const dueColor = dueInfo.isOverdue ? "#DC2626" : dueInfo.isUrgent ? "#D97706" : "#6B7280";
    const icon = dueInfo.isOverdue ? "⚠️ " : dueInfo.isUrgent ? "⏰ " : "";
    metaPills.push(`<span style="display:inline-block;padding:4px 9px;background:${dueBg};color:${dueColor};border-radius:4px;font-size:11px;font-weight:${dueInfo.isOverdue || dueInfo.isUrgent ? "600" : "500"};margin-right:6px;">${icon}${escapeHtml(dueInfo.label)}</span>`);
  }
  const metaPillsHtml = metaPills.length > 0 ? `<div style="margin:12px 0 0 0;">${metaPills.join("")}</div>` : "";

  const descriptionHtml = input.taskDescription
    ? `<p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#4B5563;white-space:pre-wrap;">${escapeHtml(input.taskDescription)}</p>`
    : "";

  const desktopIdeButtonHtml = desktopIdeLaunchUrl
    ? `<td class="action-btn-cell" style="padding:0;vertical-align:middle;">
        <a href="${escapeHtml(desktopIdeLaunchUrl)}" class="action-btn" style="display:inline-block;padding:8px 16px;font-size:13px;font-weight:600;color:#1F2937;background-color:#F9FAFB;border:1px solid #D1D5DB;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;">
          Open in ${escapeHtml(input.connectedDesktopIde?.name || "Code editor")} &#8599;
        </a>
      </td>`
    : "";

  // Task summary metadata for Apple Mail / mobile inbox preview snippet
  // Leads with taskTitle so it appears twice on the left: 1st in subject line, 2nd at start of preview snippet
  const summaryTokens: string[] = [];
  if (priorityInfo) summaryTokens.push(priorityInfo.label);
  if (statusInfo) summaryTokens.push(statusInfo);
  if (dueInfo) summaryTokens.push(dueInfo.label);
  summaryTokens.push(`in ${projectTitle}`);
  summaryTokens.push(`assigned to ${assigneeDisplayName}`);
  if (subtasks.length > 0) summaryTokens.push(`${completedSubtasks} of ${subtasks.length} subtasks completed`);
  const previewSnippet = `${taskTitle} — ${summaryTokens.join(" • ")}`;

  return {
    from: "NetworkBase <notifications@networkbase.in>",
    to: [input.email],
    reply_to: "support@networkbase.in",
    subject: `Task assigned: ${taskTitle.replace(/[\r\n]/g, " ").slice(0, 160)}`,
    text,
    headers: {
      "List-Unsubscribe": `<${settingsUrl}>, <mailto:support@networkbase.in?subject=unsubscribe>`,
    },
    html: renderEmailShell({
      title,
      preview: previewSnippet,
      crumb: { label: projectTitle, href: projectUrl },
      identity: {
        avatarHtml: assigneeAvatarHtml, label: "Assigned to", name: assigneeDisplayName, handle: assigneeUsername,
        subHtml: (assignerText || assigneeHeadline) ? `${assignerText ? `<span style="color:#4B5563;font-weight:500;">${escapeHtml(assignerText)}</span>` : ""}
                      ${(assignerText && assigneeHeadline) ? ` &bull; ` : ""}
                      ${assigneeHeadline ? `<span>${escapeHtml(assigneeHeadline)}</span>` : ""}` : null,
      },
      contentHtml: `          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;">
                ${escapeHtml(taskTitle)}
              </h1>
              ${metaPillsHtml}
              ${descriptionHtml}
            </td>
          </tr>

          ${subtasksHtml ? `<tr><td>${subtasksHtml}</td></tr>` : ""}

          ${filesHtml ? `<tr><td>${filesHtml}</td></tr>` : ""}`,
      buttonsHtml: `                  <td class="action-btn-cell" style="padding:0 8px 0 0;vertical-align:middle;">
                    <a href="${escapeHtml(url)}" class="action-btn" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-color:#C24720;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;">
                      View Task &rarr;
                    </a>
                  </td>
                  <td class="action-btn-cell" style="padding:0 8px 0 0;vertical-align:middle;">
                    <a href="${escapeHtml(projectUrl)}" class="action-btn" style="display:inline-block;padding:8px 16px;font-size:13px;font-weight:600;color:#374151;background-color:#FFFFFF;border:1px solid #D1D5DB;text-decoration:none;border-radius:6px;line-height:1.4;white-space:nowrap;text-align:center;">
                      ${escapeHtml(projectTitle)} &#8599;
                    </a>
                  </td>
                  ${desktopIdeButtonHtml}`,
      footer: { reasonHtml: `You’re receiving task updates for ${escapeHtml(projectTitle)} on NetworkBase.`, settingsUrl },
    }),
  };
}

export function retryDecision(attempts: number, firstAttemptAt: Date, now: Date, retryAfter?: string | null) {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const headerDelay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
    : retryAfter ? Math.max(0, Date.parse(retryAfter) - now.getTime()) : 0;
  const delay = Math.max(30_000 * 2 ** Math.min(attempts - 1, 7), Number.isFinite(headerDelay) ? headerDelay : 0);
  const dueAt = new Date(now.getTime() + delay);
  return attempts < MAX_ATTEMPTS && dueAt.getTime() < firstAttemptAt.getTime() + RETRY_WINDOW_MS
    ? dueAt : null;
}

const resendEventSchema = z.object({
  type: z.enum(["email.sent", "email.delivered", "email.failed", "email.bounced", "email.complained"]),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().uuid(),
    to: z.array(z.string().email()).min(1).max(50),
    bounce: z.object({ type: z.string() }).optional(),
  }),
});
export type ResendEvent = z.infer<typeof resendEventSchema>;

export function verifyResendEvent(raw: string, headers: Record<string, string>, secret: string) {
  new Webhook(secret).verify(raw, headers);
  // Svix v2 verifies without parsing; never parse/re-serialize before verification.
  return JSON.parse(raw) as unknown;
}

export function parseResendEvent(value: unknown) {
  return resendEventSchema.safeParse(value);
}

export function eventDeliveryState(event: ResendEvent): EmailDeliveryState {
  return event.type === "email.sent" ? "accepted" : event.type.slice(6) as EmailDeliveryState;
}

export function suppressionReason(event: ResendEvent) {
  return event.type === "email.complained" ? "complaint"
    : event.type === "email.bounced" && event.data.bounce?.type === "Permanent" ? "hard_bounce" : null;
}
