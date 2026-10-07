import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthHeading } from "./auth-heading";

const VARIABLES = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", note: "Project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", note: "Publishable Key" },
  { name: "SUPABASE_SECRET_KEY", note: "Secret Key, Server Only" },
];

/** Shown instead of a form while the app has no Supabase project (a fresh checkout). */
export function SetupNotice() {
  return (
    <div className="space-y-6">
      <AuthHeading
        title="Connect Supabase"
        description={
          <>
            Sign-in needs a Supabase project. Set these in{" "}
            <code className="font-mono text-[0.875em] text-foreground">.env.local</code>, then restart the dev server.
          </>
        }
      />
      <ul className="divide-y divide-border rounded-lg border bg-muted/60 text-sm">
        {VARIABLES.map((variable) => (
          <li key={variable.name} className="space-y-0.5 px-4 py-3">
            <code className="block font-mono text-[0.8125rem] font-semibold break-all text-foreground">
              {variable.name}
            </code>
            <span className="text-muted-foreground">{variable.note}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Step by step: <span className="font-medium text-foreground">README.md</span>, section “Supabase setup”.
      </p>
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href="/design">Open the Design Reference</Link>
      </Button>
    </div>
  );
}
