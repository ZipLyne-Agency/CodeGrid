import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: rootDir,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "**.cloudinary.com" },
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  async headers() {
    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    return [
      // Wallet-signing surfaces must NOT be framable (clickjacking → tricking a
      // user into signing). These entries match before the catch-all below.
      {
        source: '/token/stake',
        headers: [...baseHeaders, { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
      {
        source: '/link',
        headers: [...baseHeaders, { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
      // Everything EXCEPT the signing routes stays embeddable anywhere (press,
      // embeds). The negative lookahead ensures /token/stake and /link match
      // ONLY their strict rule above — Next applies the last matching rule, so a
      // plain catch-all would otherwise override them back to `*`. frame-ancestors
      // is the modern replacement for X-Frame-Options; we intentionally omit
      // X-Frame-Options (it only supports DENY/SAMEORIGIN and would override this).
      {
        source: '/((?!token/stake|link).*)',
        headers: [...baseHeaders, { key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
    ];
  },
};

export default nextConfig;
