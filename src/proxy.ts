import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { CSRF_COOKIE_NAME, DEV_CSRF_SECRET_FALLBACK, MINIMUM_CSRF_SECRET_LENGTH } from "@/lib/security/csrf-constants";
import { toPrivacySafeRouteMetric } from "@/lib/routing/route-metric";

const CSP_NONCE_HEADER = "x-nonce";
const ROUTE_METRIC_HEADER = "x-route-metric";
// Path and method, set here so a client can't claim them: the moderation gate treats every non-GET as a write,
// and token access (src/lib/security/token-access.ts) decides from them which routes a CLI or agent token may call.
const REQUEST_TARGET_HEADER = "x-networkbase-request-target";
const REQUEST_METHOD_HEADER = "x-networkbase-request-method";
const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
const AUTH_PROTECTED_PREFIXES = ["/discover", "/settings", "/messages", "/my-profile", "/network", "/my-work", "/u/", "/workspaces", "/org/", "/admin", "/authorize"];
// /legal/accept resolves the session so an unfinished two-step sign-in is sent to the code step first.
const AUTH_PROTECTED_EXACT = new Set(["/", "/login", "/signup", "/verify-email", "/legal/accept"]);

function toBase64Url(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url");
}

async function signValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(signature);
}

function resolveCsrfSecret() {
  const configured = process.env.CSRF_TOKEN_SECRET?.trim();
  if (configured) {
    if (configured.length < MINIMUM_CSRF_SECRET_LENGTH) {
      throw new Error(
        `CSRF_TOKEN_SECRET must be at least ${MINIMUM_CSRF_SECRET_LENGTH} characters`,
      );
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing CSRF_TOKEN_SECRET");
  }

  return DEV_CSRF_SECRET_FALLBACK;
}

async function issueSignedCsrfToken() {
  const secret = resolveCsrfSecret();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await signValue(nonce, secret);
  return `${nonce}.${signature}`;
}

function shouldResolveAuthSession(pathname: string) {
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
    return true;
  }

  if (AUTH_PROTECTED_EXACT.has(pathname)) {
    return true;
  }

  return AUTH_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function requestHostname(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return (forwarded ? forwarded.replace(/:\d+$/, "") : request.nextUrl.hostname).toLowerCase();
}

function isLocalHostname(hostname: string | null | undefined) {
  if (!hostname) return false;
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname === "[::1]";
}

const STATIC_LEGAL_PATHS = new Set([
  "/acceptable-use",
  "/cookies",
  "/copyright",
  "/dpa",
  "/eula",
  "/grievances",
  "/help/running-a-class",
  "/open-source",
  "/privacy",
  "/security-reporting",
  "/subprocessors",
  "/support",
  "/terms",
]);

function buildCsp(nonce: string | null, request: NextRequest) {
  const isProduction = process.env.NODE_ENV === "production";
  const scriptDirectives = nonce
    ? [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        "https://challenges.cloudflare.com",
        "https://accounts.google.com",
        ...(isProduction ? [] : ["'unsafe-eval'"]),
      ]
    : ["'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"])];

  const localConnectDirectives = [
    "ws://localhost:*",
    "ws://127.0.0.1:*",
    "ws://0.0.0.0:*",
  ];

  const connectDirectives = isProduction
    ? [
        "'self'",
        "https:",
        "wss:",
        ...(isLocalHostname(requestHostname(request)) ? localConnectDirectives : []),
      ]
    : ["'self'", "https:", "wss:", "http:", "ws:"];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptDirectives.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectDirectives.join(" ")}`,
    "frame-src 'self' https://challenges.cloudflare.com https://accounts.google.com blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  const shouldUpgradeInsecureRequests =
    isProduction
    && request.nextUrl.protocol === "https:"
    && !isLocalHostname(requestHostname(request));

  if (shouldUpgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ROUTE_METRIC_HEADER, toPrivacySafeRouteMetric(request.nextUrl.pathname));
  requestHeaders.set(
    REQUEST_TARGET_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  requestHeaders.set(REQUEST_METHOD_HEADER, request.method);

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const isStaticLegalPage = STATIC_LEGAL_PATHS.has(request.nextUrl.pathname);
  if (isStaticLegalPage) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", buildCsp(null, request));
    response.headers.set("X-WAF-Edge-Protected", "1");
    return response;
  }

  // Every server action POSTs to the current page, so only its id says which read or write is busy.
  const serverAction = request.headers.get("next-action");
  if (serverAction) console.info(JSON.stringify({ event: "server_action", route: toPrivacySafeRouteMetric(request.nextUrl.pathname), action: serverAction }));

  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(24)).buffer);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const isPrefetch = request.headers.get("purpose") === "prefetch"
    || request.headers.get("x-purpose") === "preview"
    || request.headers.has("next-router-prefetch");

  const response = (!isPrefetch && shouldResolveAuthSession(request.nextUrl.pathname))
    ? await updateSession(request, { requestHeaders })
    : NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });

  response.headers.set("Content-Security-Policy", buildCsp(nonce, request));
  response.headers.set(CSP_NONCE_HEADER, nonce);
  response.headers.set("X-WAF-Edge-Protected", "1");

  if (!isPrefetch) {
    const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value?.trim() || "";
    if (!csrfCookie || !csrfCookie.includes(".")) {
      response.cookies.set({
        name: CSRF_COOKIE_NAME,
        value: await issueSignedCsrfToken(),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|map|woff2?|ttf|eot|webmanifest|json|mp3)$).*)",
  ],
};
