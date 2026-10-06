import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";

/**
 * Frame for the sign-in screens (BUILD_SPEC 2.1, 3): the mist ground, the
 * lockup logo, one white card with the signature gradient along its top edge,
 * and no navigation. It checks nothing: every page reads the session itself.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-8 sm:px-6">
        {/* m-auto centres the column without pushing it off-screen when the keyboard is up. */}
        <div className="m-auto flex w-full max-w-md flex-col items-center gap-8">
          <Logo variant="lockup" loading="eager" className="h-24 sm:h-28" sizes="168px" />
          <Card className="relative w-full px-6 [--card-spacing:--spacing(9)] sm:px-10 sm:[--card-spacing:--spacing(10)]">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-brand" />
            {children}
          </Card>
        </div>
      </main>
      <footer className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-sm text-slate-600">
        SteriCare Sdn. Bhd.
      </footer>
    </div>
  );
}
