// "Send a test" in Settings › Notifications › Where it arrives (settings mix): what the test email and push say.
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { escapeHtml, renderEmailShell, renderPonytailAvatar, type EmailPayload } from "@/lib/email/contracts";
import type { WebPushPayload } from "@/lib/notifications/web-push";

export const TEST_PUSH: Omit<WebPushPayload, "id"> = {
  title: "Test from NetworkBase",
  body: "Push notifications reach this device.",
  href: "/settings#settings-notifications-delivery",
  icon: null,
  tag: "settings-test",
};

export function buildTestEmail(person: { userId: string; email: string; name: string; username: string | null; avatarUrl: string | null }): EmailPayload {
  const settingsUrl = new URL("/settings#settings-notifications-delivery", resolveAuthBaseUrl()).toString();
  const subject = "Test email from NetworkBase";
  const line = "You asked for a test from Settings. Emails from NetworkBase reach this address.";
  const html = renderEmailShell({
    title: subject,
    preview: line,
    identity: { avatarHtml: renderPonytailAvatar({ avatarUrl: person.avatarUrl, displayName: person.name, username: person.username, identityKey: person.userId }), label: "Test", name: person.name, handle: person.username, subHtml: null },
    contentHtml: `          <tr>
            <td style="padding:0 0 16px 0;">
              <h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;">${escapeHtml("It works.")}</h1>
              <p style="margin:14px 0 0 0;font-size:14px;line-height:1.6;color:#4B5563;">${escapeHtml(line)}</p>
            </td>
          </tr>`,
    buttonsHtml: `                  <td style="padding:0;vertical-align:middle;"><a href="${escapeHtml(settingsUrl)}" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-color:#C24720;text-decoration:none;border-radius:6px;">Open notification settings</a></td>`,
    footer: { reasonHtml: "You are getting this because you asked for a test email.", settingsUrl },
  });
  const text = ["It works.", "", line, "", `Open notification settings: ${settingsUrl}`, "", "You are getting this because you asked for a test email."].join("\n");
  return { from: "NetworkBase <notifications@networkbase.in>", to: [person.email], reply_to: "support@networkbase.in", subject, html, text };
}
