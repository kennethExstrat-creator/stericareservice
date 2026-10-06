/**
 * Creates the two local test accounts from BUILD_SPEC section 11:
 *   inspector@test.local (inspector) and admin@test.local (admin).
 *
 *   npm run seed:dev-users              local Supabase only
 *   npm run seed:dev-users -- --force   any project (development projects only)
 *
 * Users go through the Auth admin API, not SQL, so passwords are hashed and
 * identities created exactly as for real users. Re-running resets the
 * passwords and roles. The passwords are known, so the script refuses to touch
 * a non-local project without --force. Never run it against production.
 *
 * Needs Node 22.18+ (built-in TypeScript) and NEXT_PUBLIC_SUPABASE_URL plus
 * SUPABASE_SECRET_KEY in .env.local.
 */
import { createClient } from "@supabase/supabase-js";

const DEV_USERS = [
  { email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" },
  { email: "admin@test.local", fullName: "Test Admin", role: "admin" },
] as const;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const password = process.env.DEV_USER_PASSWORD?.trim() || "SteriCare-dev-2026";
const force = process.argv.includes("--force");

if (!url || !secretKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}

const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host) && !force) {
  console.error(
    `Refusing to create test accounts with a known password on ${host}.\n` +
      "Re-run with --force only if this is a development project, never production.",
  );
  process.exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
}

for (const devUser of DEV_USERS) {
  let userId = await findUserId(devUser.email);

  if (userId) {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      ban_duration: "none",
      user_metadata: { full_name: devUser.fullName },
    });
    if (error) throw error;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: devUser.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: devUser.fullName },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  // The auth.users trigger created the profile as an inspector; set the real
  // role here (the secret key is allowed to, per the profiles guard trigger).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role: devUser.role, active: true, full_name: devUser.fullName })
    .eq("id", userId);
  if (profileError) throw profileError;

  console.log(`${devUser.email.padEnd(22)} ${devUser.role.padEnd(9)} ready`);
}

console.log(`\nPassword for both accounts: ${password}`);
