import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * SteriCare logo for light grounds, from the website's brand artwork
 * (public/brand/). Height-driven like the website's Logo: set a height class
 * and the width follows the artwork. The shield keeps its true colours.
 */
const VARIANTS = {
  /** App header and top bars. */
  horizontal: { src: "/brand/stericare-horizontal.png", width: 1331, height: 235, sizes: "200px", heightClass: "h-8" },
  /** Login screen. */
  lockup: { src: "/brand/stericare-lockup.png", width: 1044, height: 698, sizes: "240px", heightClass: "h-28" },
  /** Compact spaces: collapsed sidebar, small headers. */
  mark: { src: "/brand/stericare-mark.png", width: 486, height: 532, sizes: "64px", heightClass: "h-8" },
} as const;

export type LogoVariant = keyof typeof VARIANTS;

type LogoProps = {
  variant?: LogoVariant;
  /** Sets the rendered height; width follows the artwork's aspect ratio. */
  className?: string;
  /** Rendered width for the image optimiser; raise it with the height. */
  sizes?: string;
  /** Makes the logo a link, e.g. to the inspections list. */
  href?: string;
  /** "eager" for logos above the fold (header, login). */
  loading?: "eager" | "lazy";
};

export function Logo({ variant = "horizontal", className, sizes, href, loading }: LogoProps) {
  const art = VARIANTS[variant];
  const classes = cn("inline-flex shrink-0", art.heightClass, className);
  const image = (
    <Image
      src={art.src}
      alt={href ? "" : "SteriCare"}
      width={art.width}
      height={art.height}
      sizes={sizes ?? art.sizes}
      loading={loading}
      className="h-full w-auto"
    />
  );

  if (!href) return <span className={classes}>{image}</span>;
  return (
    <Link
      href={href}
      aria-label="SteriCare Home"
      className={cn(
        classes,
        "rounded-md outline-none focus-ring",
      )}
    >
      {image}
    </Link>
  );
}
