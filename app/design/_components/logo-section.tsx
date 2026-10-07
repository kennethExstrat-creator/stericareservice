import Image from "next/image";
import { Logo } from "@/components/brand/logo";
import { DesignSection, Specimen } from "./design-section";

const ICONS = [
  { src: "/favicon.ico", size: 32, label: "favicon.ico", note: "16, 32, 48, 256", frame: "" },
  { src: "/icons/icon-192.png", size: 64, label: "icon-192 / 512", note: "Manifest, transparent", frame: "" },
  { src: "/apple-icon.png", size: 64, label: "apple-icon", note: "iOS home screen, white", frame: "rounded-[22%] ring-1 ring-border" },
  { src: "/icons/icon-maskable-512.png", size: 64, label: "maskable", note: "Cropped to a circle here", frame: "rounded-full ring-1 ring-border" },
];

export function LogoSection() {
  return (
    <DesignSection
      id="logo"
      description="The website's artwork for light grounds, unchanged. Height sets the size; the width follows the artwork. The shield keeps its true colours everywhere."
      source="logo.tsx.txt, brand/*.png"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Specimen label="Horizontal · App Header" className="md:col-span-2">
          <div className="flex min-h-28 flex-wrap items-center gap-8">
            <Logo variant="horizontal" loading="eager" />
            <Logo variant="horizontal" className="h-10" sizes="240px" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">32 px tall in bars, 40 px where there is room.</p>
        </Specimen>
        <Specimen label="Mark · Compact Spaces">
          <div className="flex min-h-28 items-center gap-6">
            <Logo variant="mark" className="h-8" />
            <Logo variant="mark" className="h-12" />
            <Logo variant="mark" className="h-16" sizes="96px" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Collapsed sidebar, small headers.</p>
        </Specimen>
        <Specimen label="Lockup · Login Screen" className="flex flex-col md:col-span-2">
          <div className="flex min-h-44 flex-1 items-center justify-center rounded-lg bg-mist p-6">
            <Logo variant="lockup" className="h-32" sizes="200px" />
          </div>
        </Specimen>
        <Specimen label="App Icons (From the Mark)">
          <ul className="grid grid-cols-2 gap-4">
            {ICONS.map((icon) => (
              <li key={icon.label} className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-20 items-center justify-center">
                  <Image
                    src={icon.src}
                    alt=""
                    width={icon.size}
                    height={icon.size}
                    unoptimized
                    className={icon.frame}
                  />
                </span>
                <span className="text-xs font-semibold text-foreground">{icon.label}</span>
                <span className="text-xs text-muted-foreground">{icon.note}</span>
              </li>
            ))}
          </ul>
        </Specimen>
      </div>
    </DesignSection>
  );
}
