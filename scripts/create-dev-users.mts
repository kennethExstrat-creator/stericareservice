/**
 * Creates the local test accounts: the two of BUILD_SPEC section 11 and the
 * lead inspector Kenneth asked for (8 October 2026), whose team the
 * inspector works in:
 *   lead@test.local       lead inspector, "Ngan Boon Keat"
 *   inspector@test.local  inspector, in Ngan Boon Keat's team
 *   admin@test.local      admin
 *
 *   npm run seed:dev-users              local Supabase only
 *   npm run seed:dev-users -- --force   any project (development projects only)
 *
 * Users go through the Auth admin API, not SQL, so passwords are hashed and
 * identities created exactly as for real users. Re-running resets the
 * passwords, names, roles, lead and activation of these three to the same
 * state, in the order above: an inspector's lead must be an active lead
 * inspector when it is set (the org_guard trigger, migration
 * 20261007170000), so the lead comes first. Anyone else in the lead's team
 * stays in it. The passwords are known, so the script refuses to touch a
 * non-local project without --force. Never run it against production.
 *
 * Needs the lead inspector migration (20261007170000) on the project, Node
 * 22.18+ (built-in TypeScript) and NEXT_PUBLIC_SUPABASE_URL plus
 * SUPABASE_SECRET_KEY in .env.local.
 */
import { createClient } from "@supabase/supabase-js";

type DevUser = {
  email: string;
  fullName: string;
  /** How the output names their role. */
  title: string;
  /** The profile columns behind it, as placementFor() in lib/auth/org.ts sets them. */
  role: "inspector" | "admin";
  isLead: boolean;
  /** Their lead inspector's email: an account earlier in the list. */
  lead: string | null;
};

const DEV_USERS: readonly DevUser[] = [
  { email: "lead@test.local", fullName: "Ngan Boon Keat", title: "lead inspector", role: "inspector", isLead: true, lead: null },
  { email: "inspector@test.local", fullName: "Test Inspector", title: "inspector", role: "inspector", isLead: false, lead: "lead@test.local" },
  { email: "admin@test.local", fullName: "Test Admin", title: "admin", role: "admin", isLead: false, lead: null },
];

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

// The lead inspector needs the lead columns: stop before changing anything without them.
const { error: teamsError } = await supabase.from("profiles").select("is_lead").limit(1);
if (teamsError?.code === "42703") {
  console.error(
    "This project has no lead inspectors yet. Apply supabase/migrations/20261007170000_lead_inspectors.sql " +
      "(npx supabase db push), then run this again. Nothing was changed.",
  );
  process.exit(1);
}
if (teamsError) throw teamsError;

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
}

const ids = new Map<string, string>();

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

  const leadId = devUser.lead ? ids.get(devUser.lead) : null;
  if (leadId === undefined) throw new Error(`${devUser.lead}, the lead of ${devUser.email}, must come before them.`);

  // The auth.users trigger created the profile as an inactive inspector; set
  // the real role, team and name in one update (the secret key may, per the
  // profiles guard trigger).
  const { data: saved, error: profileError } = await supabase
    .from("profiles")
    .update({ role: devUser.role, is_lead: devUser.isLead, lead_id: leadId, active: true, full_name: devUser.fullName })
    .eq("id", userId)
    .select("id");
  if (profileError) throw profileError;
  if (saved.length !== 1) throw new Error(`${devUser.email} has no profile: is the on_auth_user_created trigger missing?`);
  ids.set(devUser.email, userId);

  const team = devUser.lead ? `, in ${DEV_USERS.find((other) => other.email === devUser.lead)?.fullName}'s team` : "";
  console.log(`${devUser.email.padEnd(22)} ${devUser.title.padEnd(15)} ready${team}`);
}

console.log(`\nPassword for every account: ${password}`);
