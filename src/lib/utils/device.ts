import { Monitor, Smartphone, Tablet, Globe, type LucideIcon } from "lucide-react";

export interface DeviceInfo {
  browser: string;
  os: string;
  icon: LucideIcon;
}

export function cleanIpAddress(rawIp: string | null | undefined): string {
  if (!rawIp) return "IP unavailable";
  const trimmed = rawIp.trim();
  if (!trimmed || trimmed === "unknown" || trimmed === "undefined" || trimmed === "null") {
    return "IP unavailable";
  }
  // Strip CIDR prefix (e.g., /32 from PostgreSQL inet type for IPv4, or /128 for IPv6)
  return trimmed.replace(/\/(32|128)$/, "");
}

export function parseUserAgent(userAgent?: string | null): DeviceInfo {
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let icon: LucideIcon = Globe;

  let ua = typeof userAgent === "string" ? userAgent.trim() : "";

  // If UA is empty or the placeholder "Unknown device", check if we are in browser
  if ((!ua || ua.toLowerCase() === "unknown device") && typeof window !== "undefined" && window.navigator?.userAgent) {
    ua = window.navigator.userAgent;
  }

  if (!ua || ua.toLowerCase() === "unknown device") {
    return { browser, os, icon };
  }

  const lower = ua.toLowerCase();

  // 1. Operating System detection
  if (lower.includes("ipad") || (lower.includes("macintosh") && typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 1)) {
    os = "iPadOS";
    icon = Tablet;
  } else if (lower.includes("iphone") || lower.includes("ipod")) {
    os = "iOS";
    icon = Smartphone;
  } else if (lower.includes("mac os") || lower.includes("macos") || lower.includes("macintosh")) {
    os = "macOS";
    icon = Monitor;
  } else if (lower.includes("windows")) {
    os = "Windows";
    icon = Monitor;
  } else if (lower.includes("android")) {
    os = "Android";
    icon = lower.includes("mobile") ? Smartphone : Tablet;
  } else if (lower.includes("cros")) {
    os = "Chrome OS";
    icon = Monitor;
  } else if (lower.includes("linux")) {
    os = "Linux";
    icon = Monitor;
  }

  // 2. Browser detection
  if (lower.includes("arc/")) {
    browser = "Arc";
  } else if (lower.includes("brave")) {
    browser = "Brave";
  } else if (lower.includes("vivaldi")) {
    browser = "Vivaldi";
  } else if (lower.includes("samsungbrowser")) {
    browser = "Samsung Internet";
  } else if (lower.includes("edg/") || lower.includes("edge/") || lower.includes("edga/") || lower.includes("edgios/")) {
    browser = "Edge";
  } else if (lower.includes("opr/") || lower.includes("opera") || lower.includes("opt/")) {
    browser = "Opera";
  } else if (lower.includes("duckduckgo") || lower.includes("ddg/")) {
    browser = "DuckDuckGo";
  } else if (lower.includes("fxios") || lower.includes("firefox")) {
    browser = "Firefox";
  } else if (lower.includes("crios")) {
    browser = "Chrome";
  } else if (lower.includes("chrome") || lower.includes("chromium")) {
    browser = "Chrome";
  } else if (lower.includes("safari") && !lower.includes("chrome") && !lower.includes("android")) {
    browser = "Safari";
  }

  return { browser, os, icon };
}
