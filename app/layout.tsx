import type { Metadata, Viewport } from "next";
import { Outfit, Red_Hat_Display } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The website's two faces: Outfit for body text, Red Hat Display for headings.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const redHatDisplay = Red_Hat_Display({
  variable: "--font-redhat",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s · SteriCare QC",
    default: "SteriCare QC",
  },
  description:
    "SteriCare preshipment glove inspections: capture on iPad, review and approve on desktop.",
  applicationName: "SteriCare QC",
  appleWebApp: {
    capable: true,
    title: "SteriCare QC",
    statusBarStyle: "default",
  },
  // Lot, PO and carton numbers must stay text: iOS would otherwise turn
  // long digit runs into phone links.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
  // Internal app: nothing here belongs in a search index.
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  // White matches the app's top bars, so Safari's chrome blends into them.
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions (screen recorders, password
    // managers) add attributes to <html> before React hydrates. It covers this
    // element's own attributes only; mismatches anywhere else still surface.
    <html
      lang="en"
      className={cn(outfit.variable, redHatDisplay.variable, "h-full antialiased")}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
