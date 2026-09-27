import type { NextConfig } from "next";
import path from "path";
import nextBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withBundleAnalyzer = nextBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const e2eAuthRouteImplRelativePath =
  process.env.NODE_ENV === "production"
    ? "./src/app/api/e2e/auth/route.disabled.ts"
    : "./src/app/api/e2e/auth/route.dev.ts";
const e2eAuthRouteImplAbsolutePath =
  process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "src/app/api/e2e/auth/route.disabled.ts")
    : path.resolve(__dirname, "src/app/api/e2e/auth/route.dev.ts");

const nextConfig: NextConfig = {
  // Keep verification builds isolated from an actively running local dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // ponytail: native HTTP 308 redirects preserve query params and offload route migration to edge.
  async redirects() {
    return [
      { source: '/hub', destination: '/discover', permanent: true },
      { source: '/hub/:path*', destination: '/discover/:path*', permanent: true },
      { source: '/people', destination: '/network', permanent: true },
      { source: '/people/:path*', destination: '/network/:path*', permanent: true },
      { source: '/profile', destination: '/my-profile', permanent: true },
      { source: '/profile/:path*', destination: '/my-profile/:path*', permanent: true },
    ];
  },
  // Security headers for all routes
  async headers() {
    return [
      {
        source: '/skill-sprites.svg',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(images|skill-icons|ide-icons|social-icons|fonts)/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(favicon.ico|favicon.svg|networkbase-mark.svg|manifest.webmanifest|robots.txt|apple-touch-icon.png)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/icon-:asset(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },

  // Turbopack configuration - use absolute path to silence warning
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      "@/app/api/e2e/auth/route-impl": e2eAuthRouteImplRelativePath,
    },
  },

  // Image optimization configuration for external domains and local query strings
  images: {
    minimumCacheTTL: 2678400, // 31 days
    formats: ['image/avif', 'image/webp'],
    localPatterns: [
      {
        pathname: '/api/v1/projects/*/image',
      },
      {
        pathname: '/social-icons/heliyon.svg',
        search: '?v=20260830-2',
      },
      {
        pathname: '/**',
        search: '',
      },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Google profile pictures
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com', // GitHub avatars
      },
    ],
  },

  // Performance optimizations
  experimental: {
    scrollRestoration: true,
    // ponytail: disabling persistent dev cache avoids observed multi-second compaction stalls.
    turbopackFileSystemCacheForDev: false,
    optimizePackageImports: [
      'lucide-react',
      '@tanstack/react-query',
      'date-fns',
      'framer-motion',
      '@radix-ui/react-accordion',
      '@radix-ui/react-avatar',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@codemirror/lang-javascript',
      '@codemirror/lang-python',
      '@codemirror/lang-sql',
      '@codemirror/lang-css',
      '@codemirror/lang-html',
      '@codemirror/lang-markdown',
      '@codemirror/lang-json',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
    ],
    serverActions: {
      // Binary uploads use signed upload-intent routes. Server actions carry
      // structured metadata and compressed payloads only, keeping V8 parsing buffers minimal.
      bodySizeLimit: '4mb',
    },
  },

  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? true
        : false,
  },

  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/resources",
    "@opentelemetry/exporter-trace-otlp-grpc",
  ],
  webpack(config, { dev, isServer }) {
    config.resolve = config.resolve ?? {};
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: false,
      };
    }
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@/app/api/e2e/auth/route-impl": e2eAuthRouteImplAbsolutePath,
    };
    if (dev) {
      config.cache = {
        type: 'filesystem',
        allowCollectingMemory: false,
        maxMemoryGenerations: 1,
      };
      config.watchOptions = {
        ignored: ['**/node_modules/**', '**/.next/**', '**/coverage/**', '**/scratch/**'],
      };
    }
    return config;
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
