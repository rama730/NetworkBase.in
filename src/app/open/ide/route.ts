import { NextRequest, NextResponse } from "next/server";
import {
  buildIdeLaunchUri,
  buildIdeMarketplaceUri,
  SUPPORTED_IDES,
  type SupportedIde,
} from "@/lib/extension/ide-protocol";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId")?.trim() || "";
  const slug = searchParams.get("slug")?.trim() || projectId;
  const taskId = searchParams.get("taskId")?.trim() || null;
  const fileId = searchParams.get("fileId")?.trim() || null;
  const filePath = searchParams.get("filePath")?.trim() || null;
  const requestedIde = (searchParams.get("ide")?.trim().toLowerCase() || "cursor") as SupportedIde;

  const ide = requestedIde in SUPPORTED_IDES ? requestedIde : "cursor";
  const ideDefinition = SUPPORTED_IDES[ide];
  const ideName = ideDefinition?.name || "Code editor";

  if (!projectId && !slug) {
    return NextResponse.redirect(new URL("/discover", request.url));
  }

  const launchUri = buildIdeLaunchUri({
    ide,
    projectId: projectId || slug,
    projectSlug: slug || projectId,
    taskId,
    fileId,
    filePath,
  });

  const marketplaceUri = buildIdeMarketplaceUri(ide);
  const browserFallbackUrl = taskId
    ? `/workspaces/${encodeURIComponent(slug)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskId)}`
    : `/workspaces/${encodeURIComponent(slug)}`;

  const safeLaunchUri = escapeHtml(launchUri);
  const safeBrowserFallback = escapeHtml(browserFallbackUrl);
  const safeMarketplaceUri = escapeHtml(marketplaceUri);
  const safeIdeName = escapeHtml(ideName);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening in ${safeIdeName} — NetworkBase</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #FAF8F4;
      color: #141A1E;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      text-align: center;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 24px;
      font-size: 14px;
      font-weight: 600;
      color: #141A1E;
    }
    .brand-mark {
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background-color: #C24720;
    }
    h1 {
      font-size: 19px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }
    p {
      font-size: 14px;
      line-height: 1.5;
      color: #4B5563;
      margin-bottom: 24px;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .btn-primary {
      display: block;
      width: 100%;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      color: #FFFFFF;
      background-color: #C24720;
      border: none;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .btn-primary:hover {
      background-color: #9c3414;
    }
    .btn-secondary {
      display: block;
      width: 100%;
      padding: 9px 18px;
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      background-color: #FFFFFF;
      border: 1px solid #D1D5DB;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
    }
    .btn-secondary:hover {
      background-color: #F9FAFB;
    }
    .marketplace-link {
      margin-top: 18px;
      font-size: 12px;
      color: #6B7280;
    }
    .marketplace-link a {
      color: #C24720;
      text-decoration: none;
      font-weight: 500;
    }
    .marketplace-link a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="brand-mark"></div>
      <span>NetworkBase</span>
    </div>
    <h1>Opening in ${safeIdeName}&hellip;</h1>
    <p>A launch request has been sent to your desktop editor. If your browser asks for permission to open ${safeIdeName}, click <strong>Allow</strong>.</p>
    <div class="actions">
      <a href="${safeLaunchUri}" class="btn-primary" id="launch-btn">Launch ${safeIdeName}</a>
      <a href="${safeBrowserFallback}" class="btn-secondary">Continue in Web App &rarr;</a>
    </div>
    <div class="marketplace-link">
      Need the desktop extension? <a href="${safeMarketplaceUri}">Install for ${safeIdeName}</a>
    </div>
  </div>
  <script>
    (function() {
      // Immediate protocol dispatch governed by Ponytail: native OS execution
      window.location.href = ${JSON.stringify(launchUri).replace(/</g, "\\u003c")};
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
