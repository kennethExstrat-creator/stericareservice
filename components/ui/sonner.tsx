"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// The app is light only (docs/DESIGN.md), so the theme is fixed rather than
// read from next-themes. Rich colours come from the status tokens, never
// sonner's own palette.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      richColors
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--success-bg": "var(--color-pass-tint)",
          "--success-text": "var(--color-pass)",
          "--success-border": "var(--color-pass-border)",
          "--error-bg": "var(--color-fail-tint)",
          "--error-text": "var(--color-fail)",
          "--error-border": "var(--color-fail-border)",
          "--warning-bg": "var(--color-warn-tint)",
          "--warning-text": "var(--color-warn)",
          "--warning-border": "var(--color-warn-border)",
          "--info-bg": "var(--color-info-tint)",
          "--info-text": "var(--color-info)",
          "--info-border": "var(--color-info-border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans text-sm",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
