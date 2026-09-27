import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { SecurityRuntimeProvider } from "@/components/providers/SecurityRuntimeProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { CookieConsentRuntime } from "@/components/privacy/CookieConsentRuntime";
import { Suspense } from "react";
import "@/lib/env";
import "./globals.css";
import { buildThemePrehydrateScript } from "@/lib/theme/appearance";
import { RoutePerformanceObserver } from "@/components/observability/RoutePerformanceObserver";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";

const instrumentSans = localFont({
  src: "./fonts/InstrumentSans.ttf",
  variable: "--font-instrument-sans",
  weight: "400 700",
  display: "swap",
});
const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono.ttf",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
  preload: false,
});
const instrumentSerif = localFont({
  src: "./fonts/InstrumentSerif.ttf",
  variable: "--font-instrument-serif",
  weight: "400",
  display: "swap",
  preload: false,
});

const THEME_PREHYDRATE_SCRIPT = buildThemePrehydrateScript();
const APP_METADATA_BASE = new URL(
  resolveAuthBaseUrl({ requireConfiguredBaseInProduction: false }),
);
const SHOULD_RENDER_VERCEL_ANALYTICS =
  process.env.NODE_ENV === "production"
  && ["1", "true", "yes", "on"].includes((process.env.VERCEL || "").trim().toLowerCase());

export const metadata: Metadata = {
  metadataBase: APP_METADATA_BASE,
  applicationName: "NetworkBase",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-ink-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/icon-ink-180.png", sizes: "180x180", type: "image/png" }],
    other: [{ rel: "mask-icon", url: "/icon-mono.svg", color: "#D14E24" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: import("next").Viewport = {
  // The installed application and browser chrome use the brand's fixed Ink
  // field. Page surfaces still respond independently to the chosen theme.
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
      <RoutePerformanceObserver />
      {children}
      <CookieConsentRuntime analyticsAvailable={SHOULD_RENDER_VERCEL_ANALYTICS} />
    </ThemeProvider>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const nonce = headerStore.get("x-nonce") || undefined;
  
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
