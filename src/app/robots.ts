import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://networkbase.in";

// Decision 2026-11-26 (middle option): search engines and AI readers are welcome; AI training crawlers are not.
// Cloudflare's managed robots.txt says the same; this keeps it true if that setting is ever turned off.
const TRAINING_BOTS = ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Amazonbot", "meta-externalagent"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: TRAINING_BOTS, disallow: "/" }, {
      userAgent: "*",
      allow: [
        "/privacy",
        "/terms",
        "/eula",
        "/acceptable-use",
        "/cookies",
        "/subprocessors",
        "/copyright",
        "/grievances",
        "/security-reporting",
        "/dpa",
        "/open-source",
        "/u/",
        "/workspaces/",
        "/org/",
      ],
      disallow: [
        "/api/",
        "/admin/",
        "/authorize/",
        "/forgot-password",
        "/login",
        "/messages",
        "/monitor/",
        "/onboarding/",
        "/reset-password",
        "/settings/",
        "/signup",
        "/verify-email",
        "/my-work/",
        "/md/",
      ],
    }],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
