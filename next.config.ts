import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The iPad is the main capture device, so let one on the same Wi-Fi open
  // the dev server by the Mac's LAN address (private ranges and .local
  // names). Development only: next build and next start ignore this.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  // Do not announce the framework (X-Powered-By). The other security headers
  // come from proxy.ts (lib/auth/security-headers.ts).
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // "Fill From a Document" posts the order document (up to 4 MB,
      // DOCUMENT_MAX_BYTES) to a Server Action; the default limit is 1 MB.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
