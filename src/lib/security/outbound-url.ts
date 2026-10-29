import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

export { readBoundedBody } from "@/lib/security/bounded-body";
// @ts-expect-error Next bundles ipaddr.js without public type declarations.
import ipaddr from "next/dist/compiled/ipaddr.js/ipaddr.js";

const typedIpaddr = ipaddr as {
  parse(address: string): {
    kind(): string;
    isIPv4MappedAddress?(): boolean;
    toIPv4Address?(): { toString(): string };
  };
};

export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeOutboundUrlError";
  }
}

type ResolveAddresses = (hostname: string) => Promise<string[]>;

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

function normalizeHostname(hostname: string) {
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIpv6(address: string) {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8") || normalized.startsWith("2001:0db8")) return true;
  if (normalized.startsWith("2001::") || normalized.startsWith("2001:0:") || normalized.startsWith("2001:0000:")) {
    return true;
  }
  if (normalized.startsWith("2002:")) return true;
  if (normalized.startsWith("64:ff9b:")) return true;
  if (normalized === "100::" || normalized.startsWith("100:")) return true;

  try {
    const parsed = typedIpaddr.parse(normalized);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress?.()) {
      const mappedIpv4 = parsed.toIPv4Address?.().toString();
      if (mappedIpv4) {
        return isPrivateIpv4(mappedIpv4);
      }
    }
  } catch {
    // Fall through to the existing IPv6-only checks when parsing fails.
  }

  return false;
}

export function isBlockedIpAddress(address: string) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function defaultResolveAddresses(hostname: string) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/** Validates a URL and returns the public addresses its host resolved to. */
export async function resolvePublicTarget(
  rawUrl: string | URL,
  options: {
    resolveAddresses?: ResolveAddresses;
    allowCredentials?: boolean;
  } = {},
) {
  const url = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("Only HTTP/HTTPS URLs are supported");
  }
  if (!options.allowCredentials && (url.username || url.password)) {
    throw new UnsafeOutboundUrlError("Credentialed URLs are not allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new UnsafeOutboundUrlError("Local or internal network hosts are not allowed");
  }

  const resolveAddresses = options.resolveAddresses ?? defaultResolveAddresses;
  const addresses = net.isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError("Host could not be resolved");
  }
  if (addresses.some((address) => isBlockedIpAddress(address))) {
    throw new UnsafeOutboundUrlError("Local or private network addresses are not allowed");
  }

  return { url, addresses };
}

export async function assertPublicNetworkUrl(rawUrl: string | URL, options: Parameters<typeof resolvePublicTarget>[1] = {}) {
  return (await resolvePublicTarget(rawUrl, options)).url;
}

/**
 * SEC-006: the one egress transport. It connects only to the addresses that were validated, so a
 * second DNS answer (rebinding) cannot redirect the connection. TLS and the Host header still use the
 * URL's hostname. Bodies are strings or bytes; redirects are returned, never followed.
 */
const OUTBOUND_USER_AGENT = "NetworkBase/1.0 (+https://networkbase.in)";

export function fetchPinnedToAddresses(url: URL, init: RequestInit, addresses: readonly string[]): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = init.body;
    if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) {
      reject(new UnsafeOutboundUrlError("Unsupported request body"));
      return;
    }
    const headers = new Headers(init.headers);
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity"); // no transparent decompression here
    // https.request sends no User-Agent (fetch did); GitHub's API refuses requests without one.
    if (!headers.has("user-agent")) headers.set("user-agent", OUTBOUND_USER_AGENT);
    const targets = addresses.map((address) => ({ address, family: net.isIP(address) }));
    const lookup: net.LookupFunction = (_hostname, options, callback) => {
      if (options.all) (callback as unknown as (error: null, all: typeof targets) => void)(null, targets);
      else callback(null, targets[0]!.address, targets[0]!.family);
    };
    const method = init.method ?? "GET";
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method,
      headers: Object.fromEntries(headers),
      signal: init.signal ?? undefined,
      lookup,
    }, (res) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(name, entry));
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      const status = res.statusCode ?? 502;
      const empty = method === "HEAD" || status === 204 || status === 205 || status === 304;
      if (empty) res.resume();
      resolve(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream), {
        status,
        statusText: res.statusMessage,
        headers: responseHeaders,
      }));
    });
    request.on("error", reject);
    request.end(body ?? undefined);
  });
}

/**
 * One total deadline covers DNS validation, every redirect hop and, until `release()` is called, the
 * body read: the same signal that bounds the headers aborts a slow body (API-004). Always call
 * `release()` once the body is consumed; it is also invoked on failure.
 */
export async function fetchPublicUrlWithRedirectValidation(
  input: {
    url: string | URL;
    init?: RequestInit;
    timeoutMs?: number;
    maxRedirects?: number;
    /** Exact hostnames every hop (the first request and each redirect) must stay within. */
    allowedHosts?: readonly string[];
    fetchImpl?: typeof fetch;
    resolveAddresses?: ResolveAddresses;
  },
) {
  const timeoutMs = Math.max(250, input.timeoutMs ?? 5_000);
  const maxRedirects = Math.max(0, Math.min(input.maxRedirects ?? 3, 5));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = input.init?.signal;
  let removeAbortListener: (() => void) | null = null;
  let requestSignal: AbortSignal = controller.signal;
  if (callerSignal) {
    if (typeof AbortSignal.any === "function") {
      requestSignal = AbortSignal.any([callerSignal, controller.signal]);
    } else if (callerSignal.aborted) {
      controller.abort();
    } else {
      const handleCallerAbort = () => controller.abort();
      callerSignal.addEventListener("abort", handleCallerAbort, { once: true });
      removeAbortListener = () => callerSignal.removeEventListener("abort", handleCallerAbort);
    }
  }
  const release = () => {
    clearTimeout(timeout);
    removeAbortListener?.();
  };

  try {
    const assertHop = async (target: string | URL) => {
      const checked = await resolvePublicTarget(target, { resolveAddresses: input.resolveAddresses });
      if (input.allowedHosts && !input.allowedHosts.includes(checked.url.hostname.toLowerCase())) {
        throw new UnsafeOutboundUrlError("Host is not allowed for this provider");
      }
      return checked;
    };
    let hop = await assertHop(input.url);
    let currentUrl = hop.url;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const init = { ...input.init, redirect: "manual" as const, signal: requestSignal };
      const response = input.fetchImpl
        ? await input.fetchImpl(currentUrl, init)
        : await fetchPinnedToAddresses(currentUrl, init, hop.addresses);

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && Boolean(location);
      if (!isRedirect) {
        return { response, resolvedUrl: currentUrl, release };
      }
      await response.body?.cancel().catch(() => undefined);
      if (redirectCount >= maxRedirects) {
        throw new UnsafeOutboundUrlError("Too many redirects");
      }

      hop = await assertHop(new URL(location!, currentUrl));
      currentUrl = hop.url;
    }

    throw new UnsafeOutboundUrlError("Too many redirects");
  } catch (error) {
    release();
    throw error;
  }
}

export const GITHUB_API_HOSTS = ["api.github.com"] as const;

/** Fixed-host provider call: public-address checks, redirect revalidation, a total deadline, and a host allowlist per hop. */
export async function fetchProviderUrl(
  url: string | URL,
  allowedHosts: readonly string[],
  init?: RequestInit,
  timeoutMs = 15_000,
) {
  const { response } = await fetchPublicUrlWithRedirectValidation({ url, init, allowedHosts, timeoutMs, maxRedirects: 3 });
  return response;
}
