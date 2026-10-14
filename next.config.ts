import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The iPad is the main capture device, so let one on the same Wi-Fi open
  // the dev server by the Mac's LAN address (private ranges and .local
  // names). Development only: next build and next start ignore this.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  // Do not announce the framework (X-Powered-By). The other security headers
  // come from proxy.ts (lib/auth/security-headers.ts).
  poweredByHeader: false,
  // The dev server grew to 4.3 GB (peak 5.6 GB) over two days of edits
  // (Kenneth, 13 October 2026). Left alone, next dev gives its server half
  // the Mac's memory as heap (8 GB here), so its own restart at 80% of that
  // never came. The dev script (package.json) caps the heap at 2 GB, so Next
  // restarts it on its own at about 1.6 GB (devMemoryThresholdRestart; the
  // Turbopack cache on disk makes that quick). Server Function calls are not echoed to the
  // terminal: their arguments include base64 photo previews (Auto-Sort) and
  // the Source Documents status poll. Development only.
  logging: {
    serverFunctions: false,
  },
  // No turbopackMemoryEviction "full": on 14 October 2026 it crashed the dev
  // server ("Restore of All for task ... failed"), so Turbopack keeps its
  // default eviction; the heap cap above does the work.
  experimental: {
    serverActions: {
      // New Inspection's Source Documents send each file to be read (up to
      // 4 MB, DOCUMENT_MAX_BYTES) to a Server Action, and Auto-Sort its
      // previews; the default limit is 1 MB.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
