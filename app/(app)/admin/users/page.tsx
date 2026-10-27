import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { getUserDirectory } from "@/lib/auth/users";
import { SEARCH_PARAM, TEAM_PARAM } from "./_lib/team-filter";
import { UsersScreen } from "./_components/users-screen";

/**
 * The title checks the role too. Next resolves metadata apart from the page,
 * so a static title would still name this page on an inspector's 404 (in the
 * tab and the HTML); notFound() here swaps in the 404 page's metadata. The
 * session is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Users" };
}

/**
 * /admin/users (BUILD_SPEC 3 and 10): everyone with an account, their UID,
 * name, email and phone, invites and the invitations not yet answered, roles,
 * lead inspectors and their teams, and deactivation. Inspectors get a 404
 * from requireAdmin(); the layout above is not a security boundary, so this
 * page checks for itself. ?team= shows one lead inspector's team, or the
 * inspectors in no team (_lib/team-filter.ts); ?q= finds people in it by
 * name, email, phone number or UID (_lib/user-search.ts).
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const viewer = await requireAdmin();
  const [directory, query] = await Promise.all([getUserDirectory(viewer.id), searchParams]);
  return <UsersScreen directory={directory} team={query[TEAM_PARAM]} search={query[SEARCH_PARAM]} />;
}
