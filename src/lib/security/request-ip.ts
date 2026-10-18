import { isIP } from "node:net";

type HeaderReader = Pick<Headers, "get">;

type RequestWithNetworkHints = Request & {
  ip?: string | null;
  socket?: {
    remoteAddress?: string | null;
  } | null;
  connection?: {
    remoteAddress?: string | null;
  } | null;
};

/**
 * Client address contract (SEC-007). Outside production the first forwarded entry is used.
 * In production exactly one source is trusted, and it must be one the edge proxy overwrites
 * or appends to, never a header the client can choose:
 *   TRUSTED_PROXY_IP_HEADER  a single header the edge sets (for example cf-connecting-ip), or
 *   TRUSTED_PROXY_HOPS       how many proxies append to x-forwarded-for (default 1); the entry
 *                            that many places from the right is the client.
 * Every candidate must parse as an IP address, otherwise the client is unknown.
 */
function normalizeIpCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\[(.*)\]$/, "$1");
  return isIP(trimmed) ? trimmed : null;
}

function trustedHops() {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

function resolveForwardedIp(headers: HeaderReader): string | null {
  if (process.env.NODE_ENV !== "production") {
    return normalizeIpCandidate(headers.get("x-real-ip")) ?? normalizeIpCandidate(headers.get("x-forwarded-for")?.split(",")[0]);
  }

  const configured = process.env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (configured) return normalizeIpCandidate(headers.get(configured));

  const entries = headers.get("x-forwarded-for")?.split(",") ?? [];
  return normalizeIpCandidate(entries[entries.length - trustedHops()]);
}

export function getTrustedHeadersIp(headers: HeaderReader): string | null {
  return resolveForwardedIp(headers);
}

export function getTrustedRequestIp(request: Request): string | null {
  const hintedRequest = request as RequestWithNetworkHints;
  const directIp =
    normalizeIpCandidate(hintedRequest.ip)
    ?? normalizeIpCandidate(hintedRequest.socket?.remoteAddress)
    ?? normalizeIpCandidate(hintedRequest.connection?.remoteAddress);
  if (directIp) return directIp;

  return resolveForwardedIp(request.headers);
}

/** Expands an IPv6 address to its eight 16-bit groups, or null when it is not valid IPv6. */
function ipv6Groups(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let text = ip.split("%")[0]!;
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1]!.split(".").map(Number) as [number, number, number, number];
    text = text.slice(0, -tail[1]!.length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, rest] = text.split("::");
  const front = head ? head.split(":") : [];
  const back = rest ? rest.split(":") : [];
  const fill = text.includes("::") ? Array<string>(8 - front.length - back.length).fill("0") : [];
  return [...front, ...fill, ...back].map((group) => parseInt(group, 16));
}

/** IPv4 /24 or IPv6 /64 bucket; IPv4-mapped IPv6 addresses share the IPv4 bucket. */
export function getTrustedSubnet(ip: string | null | undefined): string {
  if (!ip || ip === "unknown") return "unknown-subnet";
  const trimmed = ip.trim();
  const groups = ipv6Groups(trimmed);
  if (groups) {
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.0/24`;
    }
    return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
  }
  if (isIP(trimmed) === 4) return `${trimmed.split(".").slice(0, 3).join(".")}.0/24`;
  return "unknown-subnet";
}
