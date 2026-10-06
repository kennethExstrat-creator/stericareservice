import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The iPad is the main capture device, so let one on the same Wi-Fi open
  // the dev server by the Mac's LAN address (private ranges and .local
  // names). Development only: next build and next start ignore this.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
};

export default nextConfig;
