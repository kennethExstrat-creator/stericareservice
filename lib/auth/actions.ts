"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "./routes";

/** Signs the current device out (other devices keep their sessions). */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect(LOGIN_PATH);
}
