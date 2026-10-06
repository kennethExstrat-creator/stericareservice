import * as React from "react"
import { cn } from "cn"

// White fields with slate-300 borders, as the website's forms. Text stays 16 px
// on touch (anything smaller makes iOS zoom on focus) and drops to 14 px only
// with a fine pointer. Read-only fields show computed values: they sit on
// muted so they never read as something to type into.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&[readonly]]:bg-muted [&[readonly]]:shadow-none fine:text-sm touch:h-11 touch:px-3 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
