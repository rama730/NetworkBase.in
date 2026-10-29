import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://networkbase.in";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
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
        "/projects/",
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
      ],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
