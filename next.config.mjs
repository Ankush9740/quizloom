/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Development-only allowlist for testing from a phone on the local network.
  allowedDevOrigins: ["10.87.130.96"]
};

export default nextConfig;
