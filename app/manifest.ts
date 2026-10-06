import type { MetadataRoute } from "next";
import { HOME_PATH } from "@/lib/auth/routes";

/**
 * Web app manifest (BUILD_SPEC 8): "Add to Home Screen" on the iPad opens the
 * app full screen at the inspections list. Served at /manifest.webmanifest;
 * proxy.ts skips .webmanifest and .png requests, so it and the icons load
 * without a session. iOS takes the home screen icon from app/apple-icon.png.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SteriCare QC",
    short_name: "SteriCare QC",
    description: "SteriCare preshipment glove inspections: capture on iPad, review and approve on desktop.",
    lang: "en",
    start_url: HOME_PATH,
    scope: "/",
    display: "standalone",
    // Portrait and landscape are both capture layouts.
    orientation: "any",
    // Mist, the app's ground, for the launch screen; white like the top bar.
    background_color: "#f5f9fc",
    theme_color: "#ffffff",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
