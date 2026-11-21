/** @type {import('next').NextConfig} */

// Base URL of the NestJS API, WITHOUT a trailing slash and WITHOUT any global prefix,
// e.g. https://me-cbo-api.onrender.com
// Must be set on the Render frontend service as a build-time env var (rewrites are
// resolved at build time, so changing it requires a redeploy).
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "me-cbo-assets.s3.amazonaws.com" },
    ],
  },

  // Proxy the browser's API calls through the frontend so the auth cookies are
  // first-party (same origin). Frontend code should call "/api/auth/login",
  // "/api/auth/me", etc. instead of the API's own URL.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self)" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
      {
        // Always re-check the service worker so a broken version can't stay cached.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
