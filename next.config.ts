import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      // Recordings are video, so the default 1MB Server Action limit rejects them.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
