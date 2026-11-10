import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { SecurityRuntimeProvider } from "@/components/providers/SecurityRuntimeProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { CookieConsentRuntime } from "@/components/privacy/CookieConsentRuntime";
import { WelcomeFlightHost } from "@/components/onboarding/WelcomeFlight";
import { SignInFlightHost } from "@/components/auth/SignInFlight";
import { buildSignInCurtainScript } from "@/lib/auth/signin-flight";
import "@/lib/env";
import "./globals.css";
import { instrumentSans, instrumentSerif, jetbrainsMono } from "./app-fonts";
import { buildThemePrehydrateScript } from "@/lib/theme/appearance";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";

const THEME_PREHYDRATE_SCRIPT = buildThemePrehydrateScript();
const SIGNIN_CURTAIN_SCRIPT = buildSignInCurtainScript();
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
      <WelcomeFlightHost />
      <SignInFlightHost />
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
        {/* Tab icons live in the static head, not in `metadata`: Next streams metadata and swaps the whole block on
            every navigation, so the tab showed the browser's blank icon until the next page's metadata arrived.
            White border and 8% inset avoids Safari's dark contrast outline around the cream tile. */}
        <link rel="icon" href="/icon-paper-tab.ico" sizes="16x16 32x32 48x48" type="image/x-icon" />
        <link rel="icon" href="/icon-paper-tab-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/icon-paper-tab.svg" sizes="any" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-paper-180.png" sizes="180x180" type="image/png" />
        <link rel="mask-icon" href="/icon-paper-mono.svg" color="#D14E24" />
        <meta content="#141A1E" data-app-theme-color="true" name="theme-color" />
        <script
          id="theme-prehydrate"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_PREHYDRATE_SCRIPT }}
          suppressHydrationWarning
        />
        <script
          id="signin-curtain"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: SIGNIN_CURTAIN_SCRIPT }}
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
