import { networkInterfaces } from "node:os";

const localDevelopmentOrigins = process.env.NODE_ENV === "development"
  ? [...new Set([
      "10.87.130.96",
      "10.200.0.96",
      ...Object.values(networkInterfaces()).flatMap(entries =>
        (entries ?? []).filter(entry => entry.family === "IPv4" && !entry.internal).map(entry => entry.address)
      )
    ])]
  : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Development-only allowlist for testing from phones as the laptop changes networks.
  ...(localDevelopmentOrigins ? { allowedDevOrigins: localDevelopmentOrigins } : {})
};

export default nextConfig;
