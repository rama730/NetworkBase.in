import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { SecurityRuntimeProvider } from "@/components/providers/SecurityRuntimeProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { CookieConsentRuntime } from "@/components/privacy/CookieConsentRuntime";
import "@/lib/env";
import "./globals.css";
import { instrumentSans, instrumentSerif, jetbrainsMono } from "./app-fonts";
import { buildThemePrehydrateScript } from "@/lib/theme/appearance";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";

const THEME_PREHYDRATE_SCRIPT = buildThemePrehydrateScript();
const APP_METADATA_BASE = new URL(
  resolveAuthBaseUrl({ requireConfiguredBaseInProduction: false }),
);

const ORGANIZATION_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://networkbase.in/#organization",
      name: "NetworkBase",
      alternateName: "NetworkBase™",
      url: "https://networkbase.in",
      logo: "https://networkbase.in/icon-paper-512.png",
      email: "support@networkbase.in",
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "support@networkbase.in",
          availableLanguage: "English",
        },
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://networkbase.in/#website",
      url: "https://networkbase.in",
      name: "NetworkBase",
      publisher: {
        "@id": "https://networkbase.in/#organization",
      },
    },
  ],
});

export const rootMetadata: Metadata = {
  metadataBase: APP_METADATA_BASE,
  applicationName: "NetworkBase",
  manifest: "/manifest.webmanifest",
  icons: {
    // Transparent margin avoids Safari's contrast outline around the cream tile.
    icon: [
      { url: "/icon-paper-tab.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/icon-paper-tab-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-paper-tab.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-paper-180.png", sizes: "180x180", type: "image/png" }],
    other: [{ rel: "mask-icon", url: "/icon-paper-mono.svg", color: "#D14E24" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const rootViewport: Viewport = {
  themeColor: "#141A1E",
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

function ThemeProviders({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <ThemeProvider nonce={nonce}>
      {children}
      <CookieConsentRuntime />
    </ThemeProvider>
  );
}

export function RootDocument({
  children,
  nonce,
}: Readonly<{
  children: React.ReactNode;
  nonce?: string;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" data-csp-nonce={nonce} suppressHydrationWarning>
      <head>
        <meta content="#141A1E" data-app-theme-color="true" name="theme-color" />
        <script
          id="theme-prehydrate"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_PREHYDRATE_SCRIPT }}
          suppressHydrationWarning
        />
        <script
          id="schema-organization"
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: ORGANIZATION_SCHEMA }}
        />
      </head>
      <body className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <SecurityRuntimeProvider nonce={nonce ?? null}>
          <Suspense fallback={<div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950" />}>
            <ThemeProviders nonce={nonce ?? undefined}>
              {children}
            </ThemeProviders>
          </Suspense>
        </SecurityRuntimeProvider>
      </body>
    </html>
  );
}
