/** @type {import('next').NextConfig} */
// The explorer runs on a SEPARATE origin from the Klarity API. The API does NOT
// send Access-Control-Allow-Origin, so a direct browser fetch to it fails CORS.
// Fix: proxy a SAME-ORIGIN path (/klarity-api/*) to the API origin via Next
// rewrites. Browser requests stay same-origin (no CORS); the Next server (dev or
// node runtime) forwards them to NEXT_PUBLIC_KLARITY_API_BASE server-side.
// The client points at /klarity-api in the browser (see lib/config.ts).
const API_BASE = process.env.NEXT_PUBLIC_KLARITY_API_BASE;

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Fall back gracefully when the env is unset so `next build` never crashes
    // (e.g. CI without the API wired up). With no base, there is simply no proxy
    // route and the app surfaces its normal "env not set" error at runtime.
    if (!API_BASE) return [];
    return [
      {
        source: '/klarity-api/:path*',
        destination: `${API_BASE.replace(/\/+$/, '')}/:path*`,
      },
    ];
  },
};

export default nextConfig;
