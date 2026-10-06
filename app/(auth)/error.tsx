"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AuthHeading } from "./_components/auth-heading";
import { BackToSignIn } from "./_components/back-to-sign-in";

/**
 * Unexpected failures on the sign-in screens (Supabase unreachable, a profile
 * lookup that errors) land here, inside the sign-in card. Expected problems,
 * such as a wrong password, are returned by the Server Actions instead.
 */
export default function AuthError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Something went wrong"
        description={
          <>
            We could not load this screen. Try again in a minute; if it keeps happening, tell your SteriCare
            administrator
            {error.digest && (
              <>
                {" "}
                and quote code <span className="font-mono text-foreground">{error.digest}</span>
              </>
            )}
            .
          </>
        }
      />
      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={() => retry()}>
          Try again
        </Button>
        <BackToSignIn />
      </div>
    </div>
  );
}
