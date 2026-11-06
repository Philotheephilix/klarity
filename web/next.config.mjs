/** @type {import('next').NextConfig} */
// The explorer runs on a SEPARATE origin from the Klarity API. It only makes
// client-side reads to NEXT_PUBLIC_KLARITY_API_BASE, so that API must send
// CORS headers allowing this explorer's origin (Access-Control-Allow-Origin).
// No rewrites/proxy here: calls go straight from the browser to the API.
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
