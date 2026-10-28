import { NextRequest, NextResponse } from "next/server";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { escapeHtml } from "@/lib/email/contracts";
import { readOrgMuteToken } from "@/lib/email/org-templates";
import { muteOrgEmails, orgLabel } from "@/lib/organizations/notify";

export const runtime = "nodejs";

// "Mute emails from <org>" (report §26.5): the signed token is the only credential. GET shows a button so mail
// scanners that open links never mute anyone; POST mutes (also the RFC 8058 one-click List-Unsubscribe-Post).

function page(body: string, status = 200) {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Email settings · NetworkBase</title></head>
<body style="margin:0;padding:48px 16px;background:#FAF8F4;color:#141A1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><main style="max-width:480px;margin:0 auto;">${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

async function resolve(request: NextRequest) {
  const parsed = readOrgMuteToken(request.nextUrl.searchParams.get("token") ?? "");
  const org = parsed ? await orgLabel(parsed.orgId) : null;
  return parsed && org ? { ...parsed, title: org.title } : null;
}

const invalid = () => page(`<h1 style="font-size:20px;">This link doesn't work</h1><p style="color:#4B5563;">Change your email choices in <a href="/settings/notifications" style="color:#C24720;">notification settings</a>.</p>`, 400);

export async function GET(request: NextRequest) {
  const limited = await enforceRouteLimit(request, "api:v1:email:org-mute", 60, 60);
  if (limited) return limited;
  const target = await resolve(request);
  if (!target) return invalid();
  return page(`<h1 style="font-size:20px;">Mute emails from ${escapeHtml(target.title)}?</h1>
<p style="color:#4B5563;line-height:1.6;">You'll still see its notifications in NetworkBase. Emails about your access, like removal or ownership, still arrive.</p>
<form method="post"><button type="submit" style="padding:9px 18px;font-size:14px;font-weight:600;color:#fff;background:#C24720;border:0;border-radius:6px;cursor:pointer;">Mute emails</button></form>`);
}

export async function POST(request: NextRequest) {
  const limited = await enforceRouteLimit(request, "api:v1:email:org-mute", 60, 60);
  if (limited) return limited;
  const target = await resolve(request);
  if (!target || !(await muteOrgEmails(target.userId, target.orgId))) return invalid();
  return page(`<h1 style="font-size:20px;">Emails from ${escapeHtml(target.title)} are muted</h1>
<p style="color:#4B5563;line-height:1.6;">Turn them back on in <a href="/settings/notifications" style="color:#C24720;">notification settings</a>.</p>`);
}
