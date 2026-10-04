import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@smartspectra/node-sdk"],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      // Recordings are video, so the default 1MB Server Action limit rejects them.
      bodySizeLimit: "50mb",
    },
    // Dashboard routes run through proxy.ts. The proxy buffers the body and,
    // past 10MB, cuts it off. Busboy then throws "Unexpected end of form".
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
