import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LOGIN_PATH } from "@/lib/auth/routes";

/** The way out of the password screens, under the card's main action. */
export function BackToSignIn({ variant = "link" }: { variant?: "link" | "outline" }) {
  return (
    <Button asChild variant={variant} size={variant === "outline" ? "lg" : "default"} className="w-full">
      <Link href={LOGIN_PATH}>
        <ArrowLeftIcon aria-hidden data-icon="inline-start" />
        Back to sign in
      </Link>
    </Button>
  );
}
