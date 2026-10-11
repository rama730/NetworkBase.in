import type { NextConfig } from "next";
import path from "path";
import nextBundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = nextBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const nextConfig: NextConfig = {
  // Keep verification builds isolated from an actively running local dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // Native HTTP 308 redirects preserve query params and offload route migration to edge.
  async redirects() {
    return [
      { source: '/hub', destination: '/discover', permanent: true },
      { source: '/hub/:path*', destination: '/discover/:path*', permanent: true },
      { source: '/people', destination: '/network', permanent: true },
      { source: '/people/:path*', destination: '/network/:path*', permanent: true },
      { source: '/profile', destination: '/my-profile', permanent: true },
      { source: '/profile/:path*', destination: '/my-profile/:path*', permanent: true },
      // Messages: Activity and Threads became the Inbox; thread and details open as drawers on the conversation.
      { source: '/messages/activity', destination: '/messages/inbox', permanent: false },
      // Merged into /messages (the sidebar's DM section now expands in place).
      { source: '/messages/home', destination: '/messages', permanent: false },
      { source: '/messages/dms', destination: '/messages', permanent: false },
      { source: '/messages/threads', destination: '/messages/inbox?filter=threads', permanent: false },
      { source: '/messages/:channelId/thread/:seq', destination: '/messages/:channelId?thread=:seq', permanent: false },
      { source: '/messages/:channelId/details', has: [{ type: 'query', key: 'tab', value: 'members' }], destination: '/messages/:channelId?details=members', permanent: false },
      { source: '/messages/:channelId/details', destination: '/messages/:channelId?details=about', permanent: false },
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
        source: '/(favicon.ico|favicon.svg|manifest.webmanifest|robots.txt|apple-touch-icon.png)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
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
    globalNotFound: true,
    scrollRestoration: true,
    // ponytail: disabling persistent dev cache avoids observed multi-second compaction stalls. ceiling: slower cold dev starts. upgrade: re-enable once Turbopack compaction stops stalling.
    turbopackFileSystemCacheForDev: false,
    optimizePackageImports: [
      'lucide-react',
      '@tanstack/react-query',
      '@radix-ui/react-avatar',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
    serverActions: {
      // Binary uploads use signed upload-intent routes. Server actions carry
      // structured metadata and compressed payloads only, keeping V8 parsing buffers minimal.
      bodySizeLimit: '4mb',
    },
  },

  compiler: {
    // The logger and metrics write through console.error/warn/info; strip only stray debug output.
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn', 'info'] }
        : false,
  },

  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  webpack(config, { dev, isServer }) {
    config.resolve = config.resolve ?? {};
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: false,
      };
    }
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

export default withBundleAnalyzer(nextConfig);
