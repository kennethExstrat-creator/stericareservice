import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { TEST_ACCOUNTS, TEST_PASSWORD } from "../support/session";
import {
  addSecurityMedia,
  createSecurityFixture,
  SECURITY_TEMPLATE_CODE,
  TINY_JPEG,
  type SecurityFixture,
  type SecurityMedia,
} from "./security/fixture";
import {
  anonClient,
  callAction,
  discoverActions,
  probe,
  resolvedLocation,
  serverSecrets,
  signedUrlLifetime,
  signedUrlsIn,
  signInSession,
  where,
  type ActionArg,
  type Client,
  type Session,
} from "./security/support";

/*
 * Security acceptance (final audit, 7 October 2026). Live, against a running
 * build (PLAYWRIGHT_BASE_URL) and the Supabase project in .env.local:
 *
 *   - every page and route handler, signed out, as an inspector, as a lead
 *     inspector with a team member, as an admin;
 *   - every Server Action, called over HTTP the way the browser calls it;
 *   - Row Level Security and Storage with supabase-js as anon, inspector,
 *     lead and admin, delete_draft_inspection(), signed URL lifetimes;
 *   - ?next= redirects, cross-site action requests, the proxy, error pages;
 *   - the client bundles, for server-only secrets.
 *
 * Security does not change with the viewport, so it runs once, in the
 * desktop project (one set of sign-ins: Supabase allows about 30 in a few
 * minutes). Everything it writes belongs to throwaway accounts and is
 * deleted in afterAll (./security/fixture.ts). Tests marked with
 * test.fail() pin a finding of the audit: they pass while the finding
 * stands and turn red once it is fixed, so the mark can go.
 */

// Not serial: one failed probe must not hide the others. Each test is independent;
// they share the fixture, which a worker builds once (one worker: playwright.config.ts).
test.describe.configure({ mode: "default" });

const SESSION_ENDED = "Your session has ended. Sign in again.";
const NO_PERMISSION = "You do not have permission to do that.";
const DEACTIVATED = "This account has been deactivated.";
const NOWHERE = "00000000-0000-4000-8000-000000000000";
const SHOTS = "screenshots/acceptance/security";

let fx: SecurityFixture;
let media: SecurityMedia;
let lead: Session;
let lead2: Session;
let member: Session;
let outsider: Session;
let pending: Session;
let admin: Session;
/** inspector@test.local: deletes the one draft it owns (see ./security/fixture.ts). */
let testInspector: Session;
let actions: Map<string, string>;
let scanned: { path: string; text: string }[] = [];

const service = () => createTestAdminClient();

test.beforeAll(async ({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Security probes run once, in the desktop project.");
  test.setTimeout(10 * 60_000);
  fx = await createSecurityFixture();
  lead = await signInSession(fx.lead.email, fx.lead.password);
  lead2 = await signInSession(fx.lead2.email, fx.lead2.password);
  member = await signInSession(fx.member.email, fx.member.password);
  outsider = await signInSession(fx.outsider.email, fx.outsider.password);
  pending = await signInSession(fx.pending.email, fx.pending.password);
  admin = await signInSession(TEST_ACCOUNTS.admin, TEST_PASSWORD);
  testInspector = await signInSession(TEST_ACCOUNTS.inspector, TEST_PASSWORD);
  media = await addSecurityMedia(fx, { member, outsider, testInspector, adminId: admin.userId });

  const { inspections: i } = fx;
  const discovered = await discoverActions(baseURL!, [
    { path: "/login", session: null },
    { path: "/forgot-password", session: null },
    { path: "/reset-password", session: null },
    { path: "/inspections", session: member },
    { path: "/inspections/new", session: member },
    { path: `/inspections/${i.mDraft.id}`, session: member },
    { path: `/inspections/${i.mDraft.id}/photos`, session: member },
    { path: `/inspections/${i.mSubmitted.id}/review`, session: admin },
    { path: `/inspections/${i.mDraft.id}`, session: admin },
    { path: "/admin", session: admin },
    { path: "/admin/users", session: admin },
    { path: "/admin/manufacturers", session: admin },
    { path: "/admin/clients", session: admin },
    { path: "/admin/defects", session: admin },
    { path: "/admin/defects/labels", session: admin },
    { path: "/admin/defects/unmapped", session: admin },
    { path: "/admin/defects/shortforms", session: admin },
    // Steri-AI Settings: each view renders (and so loads the actions of) its own client part.
    { path: "/admin/ai", session: admin },
    { path: "/admin/ai?view=inspection", session: admin },
    { path: "/admin/ai?view=cost", session: admin },
  ]);
  actions = discovered.actions;
  scanned = discovered.chunks;
});

test.afterAll(async () => {
  test.setTimeout(5 * 60_000);
  for (const session of [admin, testInspector]) await session?.client.auth.signOut({ scope: "local" }).catch(() => undefined);
  await fx?.cleanup();
  if (!fx) return;
  // Nothing of the fixture is left: no inspections, no objects, no template.
  const db = service();
  const ids = Object.values(fx.inspections).map((row) => row.id);
  const left = await db.from("inspections").select("id").in("id", ids);
  expect(left.data ?? [], "fixture inspections left behind").toEqual([]);
  const template = await db.from("templates").select("id").eq("id", fx.templateId);
  expect(template.data ?? [], "fixture template left behind").toEqual([]);
  for (const id of ids) {
    for (const bucket of ["inspection-photos", "inspection-files"]) {
      const listed = await db.storage.from(bucket).list(id, { limit: 10 });
      expect(listed.data ?? [], `objects left in ${bucket}/${id}`).toEqual([]);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Pages and route handlers
 * ------------------------------------------------------------------ */

function protectedPages(): string[] {
  const { inspections: i } = fx;
  return [
    "/",
    "/inspections",
    "/inspections?status=draft",
    "/inspections/new",
    `/inspections/${i.mDraft.id}`,
    `/inspections/${i.mDraft.id}/photos`,
    `/inspections/${i.mDraft.id}/review`,
    "/admin",
    "/admin/users",
    "/admin/roles",
    "/admin/manufacturers",
    "/admin/clients",
    "/admin/defects",
    "/admin/defects/labels",
    "/admin/defects/unmapped",
    "/admin/defects/shortforms",
    "/admin/settings",
    "/admin/ai",
    "/admin/ai?view=inspection",
    "/admin/ai?view=cost",
    "/a-page-that-does-not-exist",
  ];
}

const ADMIN_PAGES = () => [
  "/admin",
  "/admin/users",
  "/admin/roles",
  "/admin/manufacturers",
  "/admin/clients",
  "/admin/defects",
  "/admin/defects/labels",
  "/admin/defects/unmapped",
  "/admin/defects/shortforms",
  "/admin/settings",
  "/admin/ai",
  "/admin/ai?view=inspection",
  "/admin/ai?view=cost",
];

test("signed out, every page sends the visitor to sign in and every API answers 401", async ({ baseURL }) => {
  const base = new URL(baseURL!).origin;
  for (const path of protectedPages()) {
    for (const method of ["GET", "HEAD"]) {
      const answer = await probe(baseURL!, path, { method });
      const location = resolvedLocation(baseURL!, answer.location);
      expect.soft(answer.status, `${method} ${path}`).toBe(307);
      expect.soft(location?.origin, `${method} ${path} stays on the site`).toBe(base);
      expect.soft(location?.pathname, `${method} ${path} goes to sign in`).toBe("/login");
      expect.soft(answer.body, `${method} ${path} renders nothing`).not.toContain(fx.inspections.mDraft.ref);
    }
  }
  // The proxy keeps where the visitor was going, as a path on this site.
  const kept = await probe(baseURL!, `/inspections/${fx.inspections.mDraft.id}/review`);
  expect(resolvedLocation(baseURL!, kept.location)?.searchParams.get("next")).toBe(`/inspections/${fx.inspections.mDraft.id}/review`);

  const exportAnswer = await probe(baseURL!, `/api/inspections/${fx.inspections.mApproved.id}/export`);
  expect(exportAnswer.status).toBe(401);
  expect(JSON.parse(exportAnswer.body)).toEqual({ error: "unauthorized", message: "Sign in to download the export." });
  expect(exportAnswer.headers.get("cache-control")).toBe("private, no-store");

  // Open screens: sign in, forgot and reset password render; /design is hidden in production.
  for (const path of ["/login", "/forgot-password", "/reset-password"]) {
    expect.soft((await probe(baseURL!, path)).status, path).toBe(200);
  }
  expect.soft((await probe(baseURL!, "/design")).status, "/design in production").toBe(404);
  const signOut = await probe(baseURL!, "/auth/sign-out");
  expect.soft([signOut.status, where(baseURL!, signOut)]).toEqual([307, "/login"]);
  const confirm = await probe(baseURL!, "/auth/confirm?token_hash=forged&type=recovery");
  expect.soft([confirm.status, where(baseURL!, confirm)]).toEqual([307, "/login?error=link_invalid"]);
});

test("an inspector and a lead inspector get a 404 on every admin page; an admin gets each one", async ({ baseURL }) => {
  for (const path of ADMIN_PAGES()) {
    for (const [who, session] of [
      ["inspector", member],
      ["lead inspector", lead],
    ] as const) {
      const answer = await probe(baseURL!, path, { session });
      expect.soft(answer.status, `${who} ${path}`).toBe(404);
      // The 404 never names what is there (the defects pages list the templates, read after requireAdmin).
      expect.soft(answer.body, `${who} ${path} names nothing`).not.toContain(SECURITY_TEMPLATE_CODE);
    }
    expect.soft((await probe(baseURL!, path, { session: admin })).status, `admin ${path}`).toBe(200);
  }
});

/**
 * An inspection page this user may not open: the not-found screen, the same
 * as for an id that does not exist, and nothing of the inspection. The status
 * is 404 or 200: the shell and app/(app)/loading.tsx may stream before the
 * page calls notFound() (documented in inspections/[id]/not-found.tsx).
 */
async function expectNotFound(baseURL: string, path: string, session: Session, hidden: { ref: string; po?: string }) {
  const answer = await probe(baseURL, path, { session });
  expect.soft([200, 404], `${session.email} ${path}: status`).toContain(answer.status);
  expect.soft(answer.body, `${session.email} ${path}: the not-found screen`).toContain("Page Not Found");
  expect.soft(answer.body, `${session.email} ${path}: hides the ref`).not.toContain(hidden.ref);
  if (hidden.po) expect.soft(answer.body, `${session.email} ${path}: hides the PO`).not.toContain(hidden.po);
  test.info().annotations.push({ type: "not-found status", description: `${path} as ${session.email}: HTTP ${answer.status}` });
}

test("an inspector opens only their own inspections; a lead also their team's, read-only", async ({ baseURL }) => {
  const { inspections: i } = fx;
  const pages = (id: string) => [`/inspections/${id}`, `/inspections/${id}/photos`, `/inspections/${id}/review`];
  const po = (key: string) => `E2E-FINALSEC-${key}-`;

  // Another team's inspector: Max's inspection reads as missing, ref and PO included.
  for (const path of pages(i.mDraft.id)) await expectNotFound(baseURL!, path, outsider, { ref: i.mDraft.ref, po: po("mDraft") });
  // A team member does not see their lead's own inspection.
  for (const path of pages(i.lDraft.id)) await expectNotFound(baseURL!, path, member, { ref: i.lDraft.ref, po: po("lDraft") });
  // The lead opens the team's, but not another team's.
  for (const path of pages(i.mSubmitted.id)) {
    const answer = await probe(baseURL!, path, { session: lead });
    expect.soft(answer.status, `lead ${path}`).toBe(200);
    expect.soft(answer.body, `lead ${path} shows it`).toContain(i.mSubmitted.ref);
  }
  for (const path of pages(i.oDraft.id)) await expectNotFound(baseURL!, path, lead, { ref: i.oDraft.ref, po: po("oDraft") });
  // Malformed and unknown ids get the same screen, never a server error.
  for (const path of ["/inspections/not-a-uuid", "/inspections/not-a-uuid/photos", "/inspections/not-a-uuid/review", `/inspections/${NOWHERE}`]) {
    await expectNotFound(baseURL!, path, member, { ref: "INS-0000-0000" });
  }
  // The list: each sees what RLS gives them.
  const outsiderList = (await probe(baseURL!, "/inspections", { session: outsider })).body;
  expect.soft(outsiderList).toContain(i.oDraft.ref);
  expect.soft(outsiderList).not.toContain(i.mDraft.ref);
  const leadList = (await probe(baseURL!, "/inspections?q=E2E-FINALSEC", { session: lead })).body;
  expect.soft(leadList).toContain(i.mSubmitted.ref);
  expect.soft(leadList).toContain(i.lDraft.ref);
  expect.soft(leadList).not.toContain(i.oDraft.ref);
});

test("?next= and the email-link landing never send anyone to another site", async ({ baseURL }) => {
  const base = new URL(baseURL!).origin;
  const payloads = [
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example",
    "https://evil.example",
    "/.//evil.example",
    "/%2F%2Fevil.example",
    "/%09/evil.example",
    "\t//evil.example",
    "javascript:alert(1)",
    "/login?next=//evil.example",
    "/auth/sign-out",
  ];
  // Signed in, the sign-in screen forwards to ?next= (proxy.ts, safeNextPath).
  for (const payload of payloads) {
    const answer = await probe(baseURL!, `/login?next=${encodeURIComponent(payload)}`, { session: member });
    const location = resolvedLocation(baseURL!, answer.location);
    expect.soft(answer.status, payload).toBe(307);
    expect.soft(location?.origin, `next=${payload}`).toBe(base);
    expect.soft(location?.pathname.startsWith("//"), `next=${payload}`).toBe(false);
  }
  const inside = await probe(baseURL!, `/login?next=${encodeURIComponent("/inspections?status=draft")}`, { session: member });
  expect(where(baseURL!, inside)).toBe("/inspections?status=draft");

  // A real email link (generated, not sent) with a hostile next.
  const db = service();
  for (const next of ["//evil.example", "/\\evil.example", "https://evil.example/x"]) {
    const link = await db.auth.admin.generateLink({ type: "magiclink", email: fx.outsider.email });
    expect(link.error).toBeNull();
    const tokenHash = link.data.properties?.hashed_token ?? "";
    const answer = await probe(baseURL!, `/auth/confirm?token_hash=${tokenHash}&type=email&next=${encodeURIComponent(next)}`);
    const location = resolvedLocation(baseURL!, answer.location);
    expect.soft(answer.status, next).toBe(307);
    expect.soft(location?.origin, `confirm next=${next}`).toBe(base);
    expect.soft(location?.pathname, `confirm next=${next}`).toBe("/inspections");
  }
});

test("the proxy is not the boundary: odd paths and a forged middleware header still meet each page's own check", async ({ baseURL }) => {
  const forged = { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy" };
  for (const path of ["/admin/users", "/inspections", `/inspections/${fx.inspections.mDraft.id}/review`]) {
    const answer = await probe(baseURL!, path, { headers: forged });
    expect.soft(answer.status, `${path} with x-middleware-subrequest`).toBe(307);
    expect.soft(resolvedLocation(baseURL!, answer.location)?.pathname, path).toBe("/login");
  }
  // The proxy skips names that look like static files; the page still checks.
  const asImage = await probe(baseURL!, `/inspections/${fx.inspections.mDraft.id}.png`);
  expect.soft(asImage.status).toBe(307);
  expect.soft(resolvedLocation(baseURL!, asImage.location)?.pathname).toBe("/login");
  // The image optimizer is not an open proxy.
  const remote = await probe(baseURL!, "/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75");
  expect.soft(remote.status).toBe(400);
  // A plain POST to an admin page (no action) renders nothing for an inspector.
  const post = await probe(baseURL!, "/admin/users", { session: member, method: "POST", body: "" });
  expect.soft(post.status).not.toBe(200);
  expect.soft(post.body).not.toContain(fx.lead.email);
});

/* ------------------------------------------------------------------ *
 * Server Actions
 * ------------------------------------------------------------------ */

type ActionKind = "admin" | "user" | "public" | "password" | "signout" | "progress";
type ActionCase = { name: string; kind: ActionKind; path: string; args: ActionArg[] };

const idle = { status: "idle", attempt: 0 };
const form = (fields: Record<string, string>): ActionArg => ({ form: fields });

/** Every Server Action in the app, with arguments aimed at fixture rows or at nothing. */
function actionCases(): ActionCase[] {
  const { inspections: i } = fx;
  const R = randomUUID();
  const capture = `/inspections/${i.mDraft.id}`;
  const photos = `${capture}/photos`;
  const review = `/inspections/${i.mSubmitted.id}/review`;
  return [
    // Auth screens.
    { name: "signIn", kind: "public", path: "/login", args: [idle, form({ email: "not-an-email", password: "x", next: "/inspections" })] },
    { name: "requestPasswordReset", kind: "public", path: "/forgot-password", args: [idle, form({ email: "not-an-email" })] },
    { name: "updatePassword", kind: "password", path: "/reset-password", args: [idle, form({ password: "Security-e2e-2026", confirm: "Security-e2e-2026" })] },
    // Account Creation (an invitation's link session only): signed out, the link has expired.
    { name: "createAccount", kind: "password", path: "/create-account", args: [idle, form({ fullName: "Probe", phone: "0123456789", password: "Security-e2e-2026", confirm: "Security-e2e-2026" })] },
    { name: "signOut", kind: "signout", path: "/inspections", args: [] },
    // Inspections.
    { name: "createInspection", kind: "user", path: "/inspections/new", args: [{ status: "idle" }, form({ clientId: "none", manufacturerId: NOWHERE, productType: "examination", productName: "", templateId: "", previousId: "" })] },
    { name: "deleteInspection", kind: "user", path: "/inspections", args: [{ inspectionId: i.mDraft.id }] },
    { name: "saveCaptureData", kind: "user", path: capture, args: [{ inspectionId: i.mDraft.id, data: { modules: {}, custom: {} }, baseUpdatedAt: "2000-01-01T00:00:00+00:00" }] },
    { name: "submitInspection", kind: "user", path: capture, args: [{ inspectionId: i.mDraft.id, dataHash: "0000000000000000" }] },
    { name: "switchModuleOff", kind: "admin", path: capture, args: [{ status: "idle" }, form({ inspectionId: i.mDraft.id, moduleKey: "glove_info", reason: "Security e2e" })] },
    { name: "switchModuleOn", kind: "admin", path: capture, args: [{ status: "idle" }, form({ inspectionId: i.mDraft.id, moduleKey: "glove_info" })] },
    // Photos and Files.
    { name: "updatePhotoTags", kind: "user", path: photos, args: [{ status: "idle" }, form({ photoId: media.mDraftPhoto.id, moduleKey: "glove_info", caption: "changed by a probe" })] },
    { name: "deletePhoto", kind: "user", path: photos, args: [{ status: "idle" }, form({ photoId: media.mDraftPhoto.id })] },
    { name: "deleteInspectionFile", kind: "user", path: photos, args: [{ status: "idle" }, form({ fileId: media.mDraftFile.id })] },
    { name: "setPhotoInReport", kind: "admin", path: photos, args: [{ status: "idle" }, form({ photoId: media.mDraftPhoto.id, include: "true" })] },
    // Review and AI.
    { name: "approveInspection", kind: "admin", path: review, args: [{ status: "idle" }, form({ inspectionId: i.mSubmitted.id, version: "2000-01-01T00:00:00+00:00" })] },
    { name: "reopenInspection", kind: "admin", path: review, args: [{ status: "idle" }, form({ inspectionId: i.mSubmitted.id, reason: "Security e2e" })] },
    { name: "requestAiSecondOpinion", kind: "admin", path: review, args: [{ status: "idle" }, form({ inspectionId: i.mSubmitted.id })] },
    { name: "recordAiFindingDecision", kind: "admin", path: review, args: [{ status: "idle" }, form({ reviewId: media.aiReviewId, findingId: "F1", action: "agree", note: "" })] },
    { name: "sendToAiReport", kind: "admin", path: review, args: [{ status: "idle" }, form({ inspectionId: i.mSubmitted.id })] },
    { name: "getAiReviewProgress", kind: "progress", path: review, args: [i.mSubmitted.id] },
    // Admin: users.
    { name: "inviteUser", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ email: "not-an-email", role: "inspector", leadId: "", delivery: "email" })] },
    { name: "changeRole", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R, role: "admin", leadId: "" })] },
    { name: "assignLead", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R, leadId: R })] },
    { name: "deactivateUser", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R })] },
    { name: "reactivateUser", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R, role: "inspector", leadId: "" })] },
    { name: "sendPasswordLink", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R })] },
    { name: "editUserDetails", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R, fullName: "Probe", phone: "" })] },
    { name: "resendInvite", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R })] },
    { name: "createInviteLink", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R })] },
    { name: "cancelInvite", kind: "admin", path: "/admin/users", args: [{ status: "idle" }, form({ userId: R })] },
    // Admin: roles (the built-in Admin role only). A blank name is refused before anything is written.
    { name: "createRole", kind: "admin", path: "/admin/roles", args: [{ status: "idle" }, form({ name: "", description: "", access: "own" })] },
    { name: "updateRole", kind: "admin", path: "/admin/roles", args: [{ status: "idle" }, form({ id: R, version: "2000-01-01T00:00:00+00:00", name: "", description: "", access: "own" })] },
    { name: "deleteRole", kind: "admin", path: "/admin/roles", args: [{ status: "idle" }, form({ id: R })] },
    // Admin: reference data.
    { name: "saveManufacturer", kind: "admin", path: "/admin/manufacturers", args: [{ status: "idle" }, form({ id: R, version: "x", name: "Probe" })] },
    { name: "deleteManufacturer", kind: "admin", path: "/admin/manufacturers", args: [{ status: "idle" }, form({ id: R })] },
    { name: "saveClient", kind: "admin", path: "/admin/clients", args: [{ status: "idle" }, form({ id: R, version: "x", name: "Probe" })] },
    { name: "deleteClient", kind: "admin", path: "/admin/clients", args: [{ status: "idle" }, form({ id: R })] },
    { name: "removeClientLogo", kind: "admin", path: "/admin/clients", args: [{ status: "idle" }, form({ id: R })] },
    { name: "prepareLogoUpload", kind: "admin", path: "/admin/clients", args: [{ clientId: R, type: "image/png", size: 10 }] },
    { name: "confirmLogoUpload", kind: "admin", path: "/admin/clients", args: [{ clientId: R, path: `${R}/${R}.png` }] },
    { name: "saveDefectCode", kind: "admin", path: "/admin/defects", args: [{ status: "idle" }, form({ code: "", name: "" })] },
    { name: "setDefectCodeActive", kind: "admin", path: "/admin/defects", args: [{ status: "idle" }, form({ code: "zz_security_probe", active: "false" })] },
    { name: "deleteDefectCode", kind: "admin", path: "/admin/defects", args: [{ status: "idle" }, form({ code: "zz_security_probe" })] },
    { name: "mapDefectLabel", kind: "admin", path: "/admin/defects/unmapped", args: [{ status: "idle" }, form({ label: "probe", moduleKey: "visual", code: "zz_security_probe" })] },
    // The shortforms list is live: an empty shortform could never be saved, and the one to delete was never in it.
    { name: "saveShortform", kind: "admin", path: "/admin/defects/shortforms", args: [{ status: "idle" }, form({ original: "", short: "", kind: "term", meaning: "", confirmed: "false" })] },
    { name: "deleteShortform", kind: "admin", path: "/admin/defects/shortforms", args: [{ status: "idle" }, form({ original: JSON.stringify({ short: "ZZ_SECURITY_PROBE", meaning: "Security probe", confirmed: false, kind: "term", codes: [] }) })] },
    // Admin: Steri-AI Settings. Input the actions refuse anyway (a blank key, a key that is not one, blank
    // settings, an empty price list), so Anthropic is never called; the key removal has no argument: a missing
    // check would remove the live key, which is what this probe must catch.
    { name: "saveApiKeyAction", kind: "admin", path: "/admin/ai", args: [{ status: "idle" }, form({ apiKey: "" })] },
    { name: "removeAiKeyAction", kind: "admin", path: "/admin/ai", args: [] },
    { name: "testAiConnectionAction", kind: "admin", path: "/admin/ai", args: [form({ apiKey: "not-a-key" })] },
    { name: "saveInspectionSettingsAction", kind: "admin", path: "/admin/ai", args: [{ status: "idle" }, form({ documentModel: "", reviewModel: "", reviewEffort: "", reviewMaxPhotos: "" })] },
    { name: "saveAiPricesAction", kind: "admin", path: "/admin/ai", args: [{ checkedOn: "", models: [], myrPerUsd: null, myrRateOn: null }] },
  ];
}

const said = (result: unknown, words: string) => JSON.stringify(result ?? null).includes(words);

test("every Server Action is accounted for and checks the caller first", async ({ baseURL }) => {
  const cases = actionCases();
  // A new action without a probe fails here: add it to actionCases().
  expect([...actions.keys()].sort(), "Server Actions in the client bundles").toEqual(cases.map((c) => c.name).sort());

  for (const c of cases) {
    const action = { id: actions.get(c.name)!, path: c.path };
    const out = await callAction(baseURL!, action, c.args);
    switch (c.kind) {
      case "admin":
      case "user":
        expect.soft(said(out.result, SESSION_ENDED), `${c.name} signed out: ${out.raw}`).toBe(true);
        break;
      case "public":
        // Input is checked before Supabase is asked: no sign-in attempt, no email.
        expect.soft(said(out.result, "Enter a valid email address"), `${c.name}: ${out.raw}`).toBe(true);
        break;
      case "password":
        expect.soft(said(out.result, "This link has expired or was already used."), `${c.name} signed out: ${out.raw}`).toBe(true);
        break;
      case "signout":
        expect.soft(out.redirect, c.name).toBe("/login;push");
        break;
      case "progress":
        expect.soft(out.result, `${c.name} signed out`).toEqual({ ok: false });
        break;
    }

    if (c.kind === "admin") {
      for (const [who, session] of [
        ["inspector", member],
        ["lead inspector", lead],
      ] as const) {
        const answer = await callAction(baseURL!, action, c.args, { session });
        expect.soft(said(answer.result, NO_PERMISSION), `${c.name} as ${who}: ${answer.raw}`).toBe(true);
      }
    }
    if (c.kind === "admin" || c.kind === "user") {
      const answer = await callAction(baseURL!, action, c.args, { session: pending });
      expect.soft(said(answer.result, DEACTIVATED), `${c.name} as a never-activated account: ${answer.raw}`).toBe(true);
    }
  }

  // A password session cannot set a new password through the app (link sessions only).
  const update = await callAction(baseURL!, { id: actions.get("updatePassword")!, path: "/reset-password" }, actionCases().find((c) => c.name === "updatePassword")!.args, { session: member });
  expect.soft(said(update.result, "Passwords are set from an invite or reset link"), update.raw).toBe(true);

  // Nothing above changed a fixture row.
  const db = service();
  const rows = await db.from("inspections").select("id, status, module_overrides, report_url").in("id", [fx.inspections.mDraft.id, fx.inspections.mSubmitted.id]);
  for (const row of rows.data ?? []) {
    expect.soft(row.module_overrides, row.id).toEqual({});
    expect.soft(row.report_url, row.id).toBeNull();
  }
  expect.soft(rows.data?.find((row) => row.id === fx.inspections.mSubmitted.id)?.status).toBe("submitted");
  const photo = await db.from("inspection_photos").select("module_key, caption, include_in_report").eq("id", media.mDraftPhoto.id).single();
  expect.soft(photo.data).toEqual({ module_key: "header", caption: "Security e2e photo", include_in_report: false });
  const decisions = await db.from("ai_review_actions").select("id").eq("ai_review_id", media.aiReviewId);
  expect.soft(decisions.data?.length).toBe(1);
});

test("owner-only actions refuse another team's inspector and the lead, and change nothing", async ({ baseURL }) => {
  const { inspections: i } = fx;
  const db = service();
  const before = await db.from("inspections").select("updated_at, data").eq("id", i.mDraft.id).single();
  const call = (name: string, args: ActionArg[], session: Session, path = `/inspections/${i.mDraft.id}`) =>
    callAction(baseURL!, { id: actions.get(name)!, path }, args, { session });

  const save = [{ inspectionId: i.mDraft.id, data: { modules: { header: { poNo: "PROBE" } }, custom: {} }, baseUpdatedAt: before.data!.updated_at }];
  expect.soft((await call("saveCaptureData", save, outsider)).result).toMatchObject({ ok: false, reason: "not_found" });
  expect.soft((await call("saveCaptureData", save, lead)).result).toMatchObject({ ok: false, reason: "forbidden" });

  const submit = [{ inspectionId: i.mDraft.id, dataHash: "0000000000000000" }];
  expect.soft((await call("submitInspection", submit, outsider)).result).toMatchObject({ status: "error" });
  expect.soft((await call("submitInspection", submit, lead)).result).toMatchObject({
    status: "error",
    message: "This inspection can no longer be changed from this account.",
  });

  for (const session of [outsider, lead]) {
    const who = session === lead ? "lead" : "outsider";
    expect.soft((await call("deleteInspection", [{ inspectionId: i.mDraft.id }], session, "/inspections")).result, `delete as ${who}`).toMatchObject({ status: "error" });
    const photos = `/inspections/${i.mDraft.id}/photos`;
    const tags = await call("updatePhotoTags", [{ status: "idle" }, form({ photoId: media.mDraftPhoto.id, moduleKey: "glove_info", caption: "probe" })], session, photos);
    expect.soft(tags.result, `retag as ${who}`).toMatchObject({ status: "error" });
    const photo = await call("deletePhoto", [{ status: "idle" }, form({ photoId: media.mDraftPhoto.id })], session, photos);
    expect.soft(photo.result, `delete photo as ${who}`).toMatchObject({ status: "error" });
    const file = await call("deleteInspectionFile", [{ status: "idle" }, form({ fileId: media.mDraftFile.id })], session, photos);
    expect.soft(file.result, `delete file as ${who}`).toMatchObject({ status: "error" });
  }

  // "Start from previous" cannot copy another inspector's inspection.
  const count = async () => (await db.from("inspections").select("id").eq("inspector_id", fx.outsider.id)).data?.length;
  const owned = await count();
  const started = await call(
    "createInspection",
    [{ status: "idle" }, form({ clientId: "none", manufacturerId: "10000000-0000-4000-8000-000000000001", productType: "examination", productName: "", templateId: "", previousId: i.mDraft.id })],
    outsider,
    "/inspections/new",
  );
  expect.soft(started.result, started.raw).toMatchObject({ status: "error" });
  expect.soft(await count()).toBe(owned);

  // Progress of AI reviews: the owner sees a pending one, another inspector nothing.
  const pendingReview = await db
    .from("ai_reviews")
    .insert({
      inspection_id: i.mSubmitted.id,
      inspection_updated_at: new Date().toISOString(),
      inspection_fingerprint: "f".repeat(64),
      status: "pending",
    })
    .select("id")
    .single();
  expect(pendingReview.error).toBeNull();
  const review = `/inspections/${i.mSubmitted.id}/review`;
  expect.soft((await call("getAiReviewProgress", [i.mSubmitted.id], member, review)).result).toEqual({ ok: true, pending: [pendingReview.data!.id] });
  expect.soft((await call("getAiReviewProgress", [i.mSubmitted.id], outsider, review)).result).toEqual({ ok: true, pending: [] });
  await db.from("ai_reviews").delete().eq("id", pendingReview.data!.id);

  const after = await db.from("inspections").select("updated_at, data").eq("id", i.mDraft.id).single();
  expect(after.data).toEqual(before.data);
  const evidence = await db.from("inspection_photos").select("module_key, caption").eq("id", media.mDraftPhoto.id).single();
  expect(evidence.data).toEqual({ module_key: "header", caption: "Security e2e photo" });
  expect((await db.from("inspection_files").select("id").eq("id", media.mDraftFile.id)).data).toHaveLength(1);

  // Positive control: the same harness lets an admin act (and the change is undone).
  const off = await call("switchModuleOff", [{ status: "idle" }, form({ inspectionId: i.mDraft.id, moduleKey: "glove_info", reason: "Security e2e control" })], admin);
  expect(off.result, off.raw).toMatchObject({ status: "success" });
  const on = await call("switchModuleOn", [{ status: "idle" }, form({ inspectionId: i.mDraft.id, moduleKey: "glove_info" })], admin);
  expect(on.result, on.raw).toMatchObject({ status: "success" });
});

test("a Server Action sent from another site is refused before it runs", async ({ baseURL }) => {
  const target = fx.inspections.tDeletable.id;
  const action = { id: actions.get("deleteInspection")!, path: "/inspections" };
  // The owner's own session, cookies included, from a page on another site.
  const answer = await callAction(baseURL!, action, [{ inspectionId: target }], { session: testInspector, origin: "https://evil.example" });
  expect(answer.status).toBe(500);
  // The error says nothing but a digest.
  expect(answer.raw).toMatch(/^0:.*\n1:E\{"digest":"[^"]+"\}\n?$/);
  const still = await service().from("inspections").select("id").eq("id", target);
  expect(still.data).toHaveLength(1);
});

/* ------------------------------------------------------------------ *
 * Row Level Security and Storage
 * ------------------------------------------------------------------ */

const TABLES = [
  "profiles",
  "manufacturers",
  "clients",
  "defect_codes",
  "templates",
  "inspections",
  "inspection_photos",
  "inspection_files",
  "ai_reviews",
  "ai_review_actions",
  "audit_log",
] as const;

test("the anon key reads, writes, calls and signs nothing", async () => {
  const anon = anonClient();
  for (const table of TABLES) {
    const read = await anon.from(table).select("*").limit(1);
    expect.soft(read.error?.code, `anon select ${table}`).toBe("42501");
  }
  const write = await anon.from("inspections").insert({ template_id: fx.templateId, manufacturer_id: NOWHERE });
  expect.soft(write.error?.code).toBe("42501");
  for (const fn of ["is_admin", "my_profile_status", "my_team", "delete_draft_inspection", "log_inspection_event", "delete_test_inspection"] as const) {
    const args =
      fn === "delete_draft_inspection" || fn === "delete_test_inspection"
        ? { inspection_id: fx.inspections.mDraft.id }
        : fn === "log_inspection_event"
          ? { inspection_id: fx.inspections.mDraft.id, action: "probe" }
          : {};
    const called = await anon.rpc(fn, args as never);
    expect.soft(called.error?.code, `anon rpc ${fn}`).toBe("42501");
  }
  const signed = await anon.storage.from("inspection-photos").createSignedUrl(media.mDraftPhoto.path, 60);
  expect.soft(signed.data).toBeNull();
  const listed = await anon.storage.from("inspection-photos").list(fx.inspections.mDraft.id);
  expect.soft(listed.data ?? []).toEqual([]);
  const upload = await anon.storage.from("inspection-photos").upload(`${fx.inspections.mDraft.id}/${randomUUID()}.jpg`, TINY_JPEG, { contentType: "image/jpeg" });
  expect.soft(upload.error).not.toBeNull();
});

/** What one user can read of another's inspection and its evidence, through every table and Storage. */
async function reach(client: Client, inspectionId: string) {
  const [inspection, photos, files, reviews, audit] = await Promise.all([
    client.from("inspections").select("id").eq("id", inspectionId),
    client.from("inspection_photos").select("id, storage_path").eq("inspection_id", inspectionId),
    client.from("inspection_files").select("id").eq("inspection_id", inspectionId),
    client.from("ai_reviews").select("id").eq("inspection_id", inspectionId),
    client.from("audit_log").select("id").eq("inspection_id", inspectionId),
  ]);
  return {
    inspections: inspection.data?.length ?? 0,
    photos: photos.data?.length ?? 0,
    files: files.data?.length ?? 0,
    reviews: reviews.data?.length ?? 0,
    audit: audit.data?.length ?? 0,
  };
}

const nothing = { inspections: 0, photos: 0, files: 0, reviews: 0, audit: 0 };

test("an inspector reads and writes nothing of another inspector's inspections", async () => {
  const { inspections: i } = fx;
  const o = outsider.client;
  for (const key of ["mDraft", "mSubmitted", "mApproved", "lDraft"] as const) {
    expect.soft(await reach(o, i[key].id), `outsider reaching ${key}`).toEqual(nothing);
  }
  expect.soft(await reach(member.client, i.lDraft.id), "member reaching the lead's own").toEqual(nothing);
  expect.soft(await reach(member.client, i.oDraft.id), "member reaching another team's").toEqual(nothing);
  expect.soft((await o.from("ai_review_actions").select("id").eq("ai_review_id", media.aiReviewId)).data).toEqual([]);
  expect.soft((await o.from("profiles").select("id").in("id", [fx.member.id, fx.lead.id, admin.userId])).data).toEqual([]);
  expect.soft((await o.rpc("can_read_inspection", { inspection_id: i.mDraft.id })).data).toBe(false);

  // Writes: every one misses or is refused.
  expect.soft((await o.from("inspections").update({ remarks: "probe" }).eq("id", i.mDraft.id).select("id")).data).toEqual([]);
  expect.soft((await o.from("inspection_photos").update({ caption: "probe" }).eq("id", media.mDraftPhoto.id).select("id")).data).toEqual([]);
  expect.soft((await o.from("inspection_photos").delete().eq("id", media.mDraftPhoto.id).select("id")).data).toEqual([]);
  expect.soft((await o.from("inspection_files").delete().eq("id", media.mDraftFile.id).select("id")).data).toEqual([]);
  const photoId = randomUUID();
  const planted = await o.from("inspection_photos").insert({ id: photoId, inspection_id: i.mDraft.id, storage_path: `${i.mDraft.id}/${photoId}.jpg` });
  expect.soft(planted.error?.code).toBe("42501");
  expect.soft((await o.rpc("log_inspection_event", { inspection_id: i.mDraft.id, action: "probe" })).error?.code).toBe("42501");

  // Storage: not listed, not signed, not downloaded, not written, also through '..'.
  const bucket = o.storage.from("inspection-photos");
  expect.soft((await bucket.list(i.mDraft.id)).data ?? []).toEqual([]);
  expect.soft((await bucket.createSignedUrl(media.mDraftPhoto.path, 60)).data).toBeNull();
  expect.soft((await bucket.download(media.mDraftPhoto.path)).data).toBeNull();
  const traversal = `${i.oDraft.id}/../${media.mDraftPhoto.path}`;
  expect.soft((await bucket.createSignedUrl(traversal, 60)).data, "signing through ..").toBeNull();
  expect.soft((await bucket.download(traversal)).data, "downloading through ..").toBeNull();
  expect.soft((await bucket.upload(`${i.mDraft.id}/${randomUUID()}.jpg`, TINY_JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
  expect.soft((await bucket.upload(`${i.oDraft.id}/../${i.mDraft.id}/${randomUUID()}.jpg`, TINY_JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
  const root = await bucket.list("", { limit: 1000 });
  const folders = (root.data ?? []).map((entry) => entry.name);
  expect.soft(folders, "the bucket's root lists only the inspector's own folders").not.toContain(i.mDraft.id);
  expect.soft((await o.storage.from("inspection-files").createSignedUrl(media.mDraftFile.path, 60)).data).toBeNull();
  await bucket.remove([media.mDraftPhoto.path]);
  const kept = await service().storage.from("inspection-photos").list(i.mDraft.id);
  expect.soft((kept.data ?? []).map((entry) => entry.name)).toContain(`${media.mDraftPhoto.id}.jpg`);

  // Signatures stay with their owner (and admins), whoever asks.
  expect.soft((await o.storage.from("signatures").createSignedUrl(media.memberSignature, 60)).data, "another inspector's signature").toBeNull();
  expect.soft((await o.storage.from("signatures").download(media.memberSignature)).data).toBeNull();
  expect.soft((await o.storage.from("signatures").upload(`${fx.member.id}/forged.png`, TINY_JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
  expect.soft((await o.from("profiles").update({ signature_path: media.memberSignature }).eq("id", fx.outsider.id)).error?.code, "pointing at someone else's signature").toBe("23514");

  // Their own work, as a control.
  expect.soft(await reach(o, i.oDraft.id)).toMatchObject({ inspections: 1, photos: 1 });
  expect.soft((await bucket.createSignedUrl(media.oDraftPhoto.path, 60)).data?.signedUrl).toBeTruthy();
});

test("a lead inspector reads their team's inspections, read-only, and loses them when the inspector moves", async () => {
  const { inspections: i } = fx;
  const l = lead.client;
  const db = service();

  for (const key of ["mDraft", "mSubmitted", "mReopened", "mApproved"] as const) {
    expect.soft((await reach(l, i[key].id)).inspections, `lead reads ${key}`).toBe(1);
  }
  expect.soft(await reach(l, i.mDraft.id)).toMatchObject({ photos: 1, files: 1 });
  expect.soft((await reach(l, i.mSubmitted.id)).reviews).toBe(1);
  expect.soft((await reach(l, i.mDraft.id)).audit).toBeGreaterThan(0);
  expect.soft((await l.from("ai_review_actions").select("id").eq("ai_review_id", media.aiReviewId)).data).toHaveLength(1);
  expect.soft((await l.from("profiles").select("id").eq("id", fx.member.id)).data).toHaveLength(1);
  expect.soft((await l.from("profiles").select("id").in("id", [fx.outsider.id, fx.lead2.id, admin.userId])).data).toEqual([]);
  expect.soft(await reach(l, i.oDraft.id), "lead reaching another team's").toEqual(nothing);
  const signed = await l.storage.from("inspection-photos").createSignedUrl(media.mDraftPhoto.path, 60);
  expect.soft(signed.data?.signedUrl, "lead signs a team photo").toBeTruthy();
  expect.soft((await l.storage.from("inspection-files").createSignedUrl(media.mDraftFile.path, 60)).data?.signedUrl).toBeTruthy();
  expect.soft((await l.storage.from("inspection-photos").createSignedUrl(media.oDraftPhoto.path, 60)).data).toBeNull();
  // A lead reads their team's profiles, not their signatures.
  expect.soft((await l.storage.from("signatures").createSignedUrl(media.memberSignature, 60)).data, "the lead, a member's signature").toBeNull();
  expect.soft((await member.client.storage.from("signatures").createSignedUrl(media.memberSignature, 60)).data?.signedUrl, "the owner").toBeTruthy();
  expect.soft((await admin.client.storage.from("signatures").createSignedUrl(media.memberSignature, 60)).data?.signedUrl, "an admin").toBeTruthy();

  // Read-only: no write reaches the team's rows, objects or audit trail.
  expect.soft((await l.from("inspections").update({ remarks: "lead probe" }).eq("id", i.mDraft.id).select("id")).data).toEqual([]);
  expect.soft((await l.from("inspections").update({ status: "submitted" }).eq("id", i.mDraft.id).select("id")).data).toEqual([]);
  expect.soft((await l.from("inspections").update({ status: "approved" }).eq("id", i.mSubmitted.id).select("id")).data).toEqual([]);
  expect.soft((await l.from("inspection_photos").update({ caption: "lead probe" }).eq("id", media.mDraftPhoto.id).select("id")).data).toEqual([]);
  expect.soft((await l.from("inspection_photos").delete().eq("id", media.mDraftPhoto.id).select("id")).data).toEqual([]);
  expect.soft((await l.from("inspection_files").delete().eq("id", media.mDraftFile.id).select("id")).data).toEqual([]);
  const photoId = randomUUID();
  expect.soft((await l.from("inspection_photos").insert({ id: photoId, inspection_id: i.mDraft.id, storage_path: `${i.mDraft.id}/${photoId}.jpg` })).error?.code).toBe("42501");
  expect.soft((await l.storage.from("inspection-photos").upload(`${i.mDraft.id}/${randomUUID()}.jpg`, TINY_JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
  await l.storage.from("inspection-photos").remove([media.mDraftPhoto.path]);
  expect.soft(((await db.storage.from("inspection-photos").list(i.mDraft.id)).data ?? []).map((entry) => entry.name)).toContain(`${media.mDraftPhoto.id}.jpg`);
  expect.soft((await l.rpc("log_inspection_event", { inspection_id: i.mDraft.id, action: "lead.probe" })).error?.code).toBe("42501");
  expect.soft((await l.rpc("delete_draft_inspection", { inspection_id: i.mDraft.id })).data).toBeNull();
  expect.soft((await l.from("ai_reviews").update({ summary: "lead probe" }).eq("id", media.aiReviewId).select("id")).data ?? []).toEqual([]);
  expect.soft((await l.from("ai_review_actions").insert({ ai_review_id: media.aiReviewId, finding_id: "F1", action: "agree" })).error?.code).toBe("42501");
  expect.soft((await l.from("profiles").update({ full_name: "Renamed by lead" }).eq("id", fx.member.id).select("id")).data).toEqual([]);
  expect.soft((await l.from("profiles").update({ lead_id: null }).eq("id", fx.member.id).select("id")).data ?? []).toEqual([]);

  // Moved to Lars's team: Lena loses Max at once, Lars gains him. Then back.
  const moved = await db.from("profiles").update({ lead_id: fx.lead2.id }).eq("id", fx.member.id);
  expect(moved.error).toBeNull();
  try {
    expect.soft(await reach(l, i.mDraft.id), "old lead after the move").toEqual(nothing);
    expect.soft((await l.storage.from("inspection-photos").createSignedUrl(media.mDraftPhoto.path, 60)).data).toBeNull();
    expect.soft((await reach(lead2.client, i.mDraft.id)).inspections, "new lead after the move").toBe(1);
  } finally {
    const back = await db.from("profiles").update({ lead_id: fx.lead.id }).eq("id", fx.member.id);
    expect(back.error).toBeNull();
  }
  expect.soft((await reach(lead2.client, i.mDraft.id)).inspections, "Lars after Max went back").toBe(0);
});

test("an inspector cannot approve, override, pick report photos, write AI rows or the audit log, or change who they are", async () => {
  const { inspections: i } = fx;
  const m = member.client;
  const code = async (query: PromiseLike<{ error: { code?: string } | null }>) => (await query).error?.code ?? "ok";
  const rows = async (query: PromiseLike<{ data: unknown[] | null }>) => (await query).data?.length ?? 0;

  expect.soft(await code(m.from("inspections").update({ status: "approved" }).eq("id", i.mDraft.id)), "draft to approved").toBe("23514");
  expect.soft(await rows(m.from("inspections").update({ status: "approved" }).eq("id", i.mSubmitted.id).select("id")), "approve own submitted").toBe(0);
  expect.soft(await rows(m.from("inspections").update({ status: "reopened" }).eq("id", i.mSubmitted.id).select("id")), "reopen own").toBe(0);
  expect.soft(await rows(m.from("inspections").update({ remarks: "probe" }).eq("id", i.mSubmitted.id).select("id")), "edit own submitted").toBe(0);
  expect.soft(await rows(m.from("inspections").update({ remarks: "probe" }).eq("id", i.mApproved.id).select("id")), "edit own approved").toBe(0);
  expect.soft(await code(m.from("inspections").update({ report_url: "https://evil.example/report" }).eq("id", i.mDraft.id)), "report_url").toBe("42501");
  expect.soft(await code(m.from("inspections").update({ module_overrides: { glove_info: { reason: "x", by: fx.member.id, at: "2026-10-07T00:00:00Z" } } }).eq("id", i.mDraft.id)), "module_overrides").toBe("42501");
  expect.soft(await code(m.from("inspections").update({ submitted_at: new Date().toISOString() }).eq("id", i.mDraft.id)), "submitted_at").toBe("42501");
  expect.soft(await code(m.from("inspections").update({ ref_no: "INS-2026-0001" }).eq("id", i.mDraft.id)), "ref_no").toBe("42501");
  expect.soft(await code(m.from("inspections").update({ inspector_id: fx.outsider.id }).eq("id", i.mDraft.id)), "inspector_id").toBe("42501");
  expect.soft(await code(m.from("inspections").update({ id: randomUUID() }).eq("id", i.mDraft.id)), "id").toBe("42501");
  expect.soft(await rows(m.from("inspections").delete().eq("id", i.mDraft.id).select("id")), "delete own through the API").toBe(0);
  expect.soft(await code(m.from("inspections").insert({ template_id: fx.templateId, manufacturer_id: "10000000-0000-4000-8000-000000000001" })), "start from a draft template").toBe("23514");
  // An active template, so the insert meets row level security (the guard refuses a draft template first).
  const active = await service().from("templates").select("id").eq("status", "active").limit(1);
  if (active.data?.[0]) {
    expect.soft(await code(m.from("inspections").insert({ template_id: active.data[0].id, inspector_id: fx.outsider.id })), "insert for someone else").toBe("42501");
  }
  expect.soft(await code(m.from("inspections").insert({ template_id: fx.templateId, ref_no: "INS-2026-9999" })), "choose ref_no").toBe("42501");

  expect.soft(await code(m.from("inspection_photos").update({ include_in_report: true }).eq("id", media.mDraftPhoto.id)), "include_in_report").toBe("42501");
  expect.soft(await rows(m.from("inspection_photos").update({ caption: "probe" }).eq("id", media.mApprovedPhoto.id).select("id")), "caption on approved").toBe(0);
  expect.soft(await rows(m.from("inspection_photos").delete().eq("id", media.mApprovedPhoto.id).select("id")), "delete approved photo").toBe(0);
  expect.soft((await m.storage.from("inspection-photos").upload(`${i.mApproved.id}/${randomUUID()}.jpg`, TINY_JPEG, { contentType: "image/jpeg" })).error, "upload to approved").not.toBeNull();

  expect.soft(await code(m.from("ai_reviews").insert({ inspection_id: i.mDraft.id, inspection_updated_at: new Date().toISOString() })), "insert AI review").toBe("42501");
  expect.soft(await rows(m.from("ai_reviews").update({ summary: "probe" }).eq("id", media.aiReviewId).select("id")), "edit own AI review").toBe(0);
  expect.soft(await code(m.from("ai_review_actions").insert({ ai_review_id: media.aiReviewId, finding_id: "F1", action: "agree" })), "decide on a finding").toBe("42501");
  expect.soft((await m.from("ai_review_actions").select("id").eq("ai_review_id", media.aiReviewId)).data, "decisions stay with admins").toEqual([]);
  expect.soft(await code(m.from("audit_log").insert({ inspection_id: i.mDraft.id, action: "probe" })), "insert audit row").toBe("42501");
  expect.soft(await code(m.rpc("log_inspection_event", { inspection_id: i.mDraft.id, action: "created" })), "log a trigger-owned action").toBe("42501");

  for (const change of [{ role: "admin" as const }, { is_lead: true }, { lead_id: null }, { active: false }, { email: "someone@else.example" }]) {
    expect.soft(await code(m.from("profiles").update(change).eq("id", fx.member.id)), `own profile ${JSON.stringify(change)}`).toBe("42501");
  }
  expect.soft(await rows(m.from("templates").update({ status: "active" }).eq("id", fx.templateId).select("id")), "activate a template").toBe(0);
  expect.soft(await code(m.from("clients").insert({ name: "E2E_FINAL_SEC probe client" })), "insert client").toBe("42501");
  expect.soft(await rows(m.from("manufacturers").update({ notes: "probe" }).eq("id", "10000000-0000-4000-8000-000000000001").select("id")), "edit manufacturer").toBe(0);
  expect.soft(await code(m.from("defect_codes").insert({ code: "zz_security_probe", name: "Probe" })), "insert defect code").toBe("42501");

  // The owner's own session no longer writes their draft or reopened inspection either: the app
  // saves it for them (migration 20261007190000, SEC-02). Reading their AI review still works.
  for (const [what, id] of [
    ["owner edits a draft", i.mDraft.id],
    ["owner edits a reopened one", i.mReopened.id],
  ] as const) {
    const { error } = await m.from("inspections").update({ remarks: "owner edit" }).eq("id", id);
    expect.soft([error?.code, error?.message], what).toEqual(["42501", "inspectors save and submit inspections through the app"]);
  }
  expect.soft((await m.from("ai_reviews").select("id").eq("id", media.aiReviewId)).data, "owner reads their AI review").toHaveLength(1);
});

test("delete_draft_inspection deletes only the caller's own never-submitted draft, or an admin's", async ({ baseURL }) => {
  test.setTimeout(150_000);
  const { inspections: i } = fx;
  const del = (session: Session, id: string) => session.client.rpc("delete_draft_inspection", { inspection_id: id });
  const db = service();

  for (const key of ["mDeletable", "tDeletable"] as const) {
    expect.soft((await del(pending, i[key].id)).error?.code, `never-activated account, ${key}`).toBe("42501");
    expect.soft((await del(outsider, i[key].id)).data, `another inspector, ${key}`).toBeNull();
  }
  expect.soft((await del(lead, i.mDeletable.id)).data, "the lead, a team member's draft").toBeNull();
  expect.soft((await del(member, i.tDeletable.id)).data, "another inspector's draft").toBeNull();
  expect.soft((await del(member, i.lDraft.id)).data, "a member, the lead's draft").toBeNull();
  expect.soft((await del(member, NOWHERE)).data, "nothing").toBeNull();
  for (const key of ["mSubmitted", "mReopened", "mApproved"] as const) {
    expect.soft((await del(member, i[key].id)).error?.code, `owner, ${key}`).toBe("23514");
    expect.soft((await del(admin, i[key].id)).error?.code, `admin, ${key}`).toBe("23514");
  }
  const survivors = await db.from("inspections").select("id").in("id", [i.mDeletable.id, i.tDeletable.id, i.mSubmitted.id, i.mReopened.id, i.mApproved.id, i.lDraft.id]);
  expect(survivors.data).toHaveLength(6);

  // The owner, through the list's Delete action: rows and objects go.
  const owner = testInspector;
  const link = await owner.client.storage.from("inspection-photos").createSignedUrl(media.tDeletablePhoto.path, 600);
  expect(link.data?.signedUrl).toBeTruthy();
  const signedLink = link.data!.signedUrl;
  const status = async (url: string) => {
    const answer = await fetch(url);
    await answer.arrayBuffer();
    return answer.status;
  };
  const withToken = (token: string | null) => {
    const url = new URL(signedLink);
    if (token === null) url.searchParams.delete("token");
    else url.searchParams.set("token", token);
    return url.toString();
  };
  const thumbLink = await owner.client.storage.from("inspection-photos").createSignedUrl(media.tDeletablePhoto.thumb, 600);
  const thumbToken = new URL(thumbLink.data!.signedUrl).searchParams.get("token")!;
  expect(await status(signedLink)).toBe(200);
  // Cached at Supabase's CDN now; the edge still checks every token.
  expect.soft(await status(signedLink), "the link again (from the CDN)").toBe(200);
  expect.soft(await status(withToken("forged")), "a forged token").toBe(400);
  expect.soft(await status(withToken(null)), "no token").toBe(400);
  expect.soft(await status(withToken(thumbToken)), "another object's token").toBe(400);

  const deleted = await callAction(baseURL!, { id: actions.get("deleteInspection")!, path: "/inspections" }, [{ inspectionId: i.tDeletable.id }], { session: owner });
  expect(deleted.result, deleted.raw).toEqual({ status: "deleted" });
  expect((await db.from("inspections").select("id").eq("id", i.tDeletable.id)).data).toEqual([]);
  const folder = await db.storage.from("inspection-photos").list(i.tDeletable.id);
  expect(folder.error).toBeNull();
  expect(folder.data).toEqual([]);
  expect((await db.storage.from("inspection-photos").list(`${i.tDeletable.id}/thumbs`)).data ?? []).toEqual([]);
  expect((await db.storage.from("inspection-photos").createSignedUrl(media.tDeletablePhoto.path, 60)).error?.message).toBe("Object not found");
  expect((await owner.client.storage.from("inspection-photos").createSignedUrl(media.tDeletablePhoto.path, 60)).data).toBeNull();
  // A link handed out before the delete may answer from the CDN until Supabase purges it
  // (seen: 20 s); then it fails. A forged token never works.
  expect.soft(await status(withToken("forged")), "a forged token after the delete").toBe(400);
  const purged = Date.now();
  await expect.poll(() => status(signedLink), { timeout: 100_000, intervals: [5_000] }).toBeGreaterThanOrEqual(400);
  test.info().annotations.push({ type: "evidence", description: `the deleted photo's signed link stopped working ${Math.round((Date.now() - purged) / 1000)} s after the delete` });
  const record = await db.from("audit_log").select("actor_id, changes").eq("action", "deleted").eq("changes->>inspection_id", i.tDeletable.id).single();
  expect(record.data?.actor_id).toBe(fx.testInspectorId);
  expect(record.data?.changes).toMatchObject({ via: "delete_draft_inspection", inspector_id: fx.testInspectorId, photos: 1 });

  // An admin deletes anyone's never-submitted draft.
  const byAdmin = await del(admin, i.mForAdminDelete.id);
  expect(byAdmin.error).toBeNull();
  expect(byAdmin.data).toMatchObject({ inspection_id: i.mForAdminDelete.id, ref_no: i.mForAdminDelete.ref });
  // Its id is never used again.
  const reused = await db.from("inspections").insert({ id: i.mForAdminDelete.id, template_id: fx.templateId, inspector_id: fx.member.id });
  expect(reused.error?.code).toBe("23505");

  // The records of both deletions are for admins: not the owner, not the lead, not the one who deleted.
  const records = [i.tDeletable.id, i.mForAdminDelete.id];
  const deletionRecords = (client: Client) => client.from("audit_log").select("id").eq("action", "deleted").in("changes->>inspection_id", records);
  for (const [who, session] of [
    ["the inspector whose draft an admin deleted", member],
    ["their lead", lead],
    ["the inspector who deleted their own draft", testInspector],
  ] as const) {
    expect.soft((await deletionRecords(session.client)).data, who).toEqual([]);
  }
  expect.soft((await deletionRecords(admin.client)).data, "an admin").toHaveLength(2);
});

test("signed URLs: 1 hour on screens, 24 hours in the export, and the export is for its inspector, their lead and admins only", async ({ baseURL }) => {
  const { inspections: i } = fx;

  const gallery = await probe(baseURL!, `/inspections/${i.mDraft.id}/photos`, { session: member });
  const galleryUrls = signedUrlsIn(gallery.body);
  expect(galleryUrls.length, "the gallery shows signed links").toBeGreaterThan(0);
  for (const url of galleryUrls) expect.soft(signedUrlLifetime(url), "gallery link").toBe(60 * 60);

  const reviewPage = await probe(baseURL!, `/inspections/${i.mApproved.id}/review`, { session: admin });
  const reviewUrls = signedUrlsIn(reviewPage.body);
  expect(reviewUrls.length, "the review shows the report photo").toBeGreaterThan(0);
  for (const url of reviewUrls) expect.soft(signedUrlLifetime(url), "review link").toBe(60 * 60);

  const own = await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: member });
  expect(own.status).toBe(200);
  expect(own.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
  expect(own.headers.get("cache-control")).toBe("private, no-store");
  const exportDoc = JSON.parse(own.body) as { refNo: string };
  expect(exportDoc.refNo).toBe(i.mApproved.ref);
  const exportUrls = signedUrlsIn(own.body);
  expect(exportUrls.length, "the export links its photo").toBeGreaterThan(0);
  for (const url of exportUrls) expect.soft(signedUrlLifetime(url), "export link").toBe(24 * 60 * 60);

  expect.soft((await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: admin })).status, "admin").toBe(200);
  expect.soft((await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: outsider })).status, "another inspector").toBe(404);
  // A lead downloads their team's reports (Kenneth, 27 October 2026), not another team's.
  expect.soft((await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: lead })).status, "their lead").toBe(200);
  expect.soft((await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: lead2 })).status, "another team's lead").toBe(404);
  expect.soft((await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: pending })).status, "never activated").toBe(403);
  expect.soft((await probe(baseURL!, "/api/inspections/not-a-uuid/export", { session: member })).status, "malformed id").toBe(404);
  expect.soft((await probe(baseURL!, `/api/inspections/${NOWHERE}/export`, { session: member })).status, "no such inspection").toBe(404);
  expect.soft((await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: member, method: "POST" })).status, "POST").toBe(405);
  const crossSite = await probe(baseURL!, `/api/inspections/${i.mApproved.id}/export`, { session: member, headers: { Origin: "https://evil.example" } });
  expect.soft(crossSite.headers.get("access-control-allow-origin"), "no CORS for another site").toBeNull();
});

test("a never-activated account and a deactivated one read nothing and are turned away", async ({ baseURL }) => {
  const p = pending.client;
  for (const table of TABLES) {
    const read = await p.from(table).select("*").limit(5);
    expect.soft(read.data ?? [], `never-activated reads ${table}`).toEqual([]);
  }
  expect.soft((await p.rpc("my_profile_status")).data).toEqual([{ active: false, role: "inspector", is_lead: false, lead_id: null }]);
  expect.soft((await p.from("profiles").update({ active: true }).eq("id", fx.pending.id).select("id")).data ?? []).toEqual([]);
  const turnedAway = await probe(baseURL!, "/inspections", { session: pending });
  expect.soft([turnedAway.status, where(baseURL!, turnedAway)]).toEqual([307, "/auth/sign-out?reason=deactivated"]);
  const signedOut = await probe(baseURL!, "/auth/sign-out?reason=deactivated", { session: pending });
  expect.soft([signedOut.status, where(baseURL!, signedOut)]).toEqual([307, "/login?error=deactivated"]);

  // Max is deactivated with a session open: his token still verifies, RLS gives him nothing.
  const db = service();
  const off = await db.from("profiles").update({ active: false }).eq("id", fx.member.id);
  expect(off.error).toBeNull();
  try {
    expect.soft(await reach(member.client, fx.inspections.mDraft.id), "deactivated owner").toEqual(nothing);
    expect.soft((await member.client.storage.from("inspection-photos").createSignedUrl(media.mDraftPhoto.path, 60)).data).toBeNull();
    const page = await probe(baseURL!, `/inspections/${fx.inspections.mDraft.id}`, { session: member });
    expect.soft([page.status, where(baseURL!, page)]).toEqual([307, "/auth/sign-out?reason=deactivated"]);
    const action = await callAction(baseURL!, { id: actions.get("saveCaptureData")!, path: `/inspections/${fx.inspections.mDraft.id}` }, [{ inspectionId: fx.inspections.mDraft.id, data: { modules: {}, custom: {} }, baseUpdatedAt: "x" }], { session: member });
    expect.soft(said(action.result, DEACTIVATED), action.raw).toBe(true);
    expect.soft((await probe(baseURL!, `/api/inspections/${fx.inspections.mApproved.id}/export`, { session: member })).status).toBe(403);
    // His lead still sees the team's inspections (DATABASE.md: a deactivated member stays visible).
    expect.soft((await reach(lead.client, fx.inspections.mDraft.id)).inspections).toBe(1);
  } finally {
    const on = await db.from("profiles").update({ active: true }).eq("id", fx.member.id);
    expect(on.error).toBeNull();
  }
});

/* ------------------------------------------------------------------ *
 * Bundles, errors and headers
 * ------------------------------------------------------------------ */

test("the client bundles and pages carry no server-only secret", async ({ baseURL }) => {
  const secrets = serverSecrets();
  expect(Object.keys(secrets), "secrets to look for").toContain("SUPABASE_SECRET_KEY");
  const texts = [...scanned];
  for (const path of ["/login", "/inspections", "/admin", "/admin/users", `/inspections/${fx.inspections.mApproved.id}/review`]) {
    texts.push({ path, text: (await probe(baseURL!, path, { session: path === "/login" ? null : admin })).body });
  }
  expect(texts.length).toBeGreaterThan(20);
  for (const { path, text } of texts) {
    for (const [name, value] of Object.entries(secrets)) {
      expect.soft(text.includes(value), `${name} in ${path}`).toBe(false);
    }
    expect.soft(/sb_secret_[A-Za-z0-9_-]{8,}/.test(text), `a secret key in ${path}`).toBe(false);
    expect.soft(/postgres(?:ql)?:\/\/[^\s"'`]+@/.test(text), `a database URL in ${path}`).toBe(false);
    expect.soft(/sk-ant-[A-Za-z0-9_-]{10,}/.test(text), `an Anthropic key in ${path}`).toBe(false);
  }
});

test("error pages and answers say nothing about the server", async ({ baseURL }) => {
  const leaks = /PGRST|postgres|SQLSTATE|supabase\.co\/rest|at [A-Za-z0-9_.<>]+ \(|node_modules|\.next\/server|SUPABASE_/;
  const notFound = [
    await probe(baseURL!, "/a-page-that-does-not-exist", { session: member }),
    await probe(baseURL!, "/api/inspections/not-a-uuid/export", { session: member }),
    // Admin > Templates is gone (Kenneth, 26 October 2026): its address is an unknown one, even for an admin.
    await probe(baseURL!, "/admin/templates", { session: admin }),
  ];
  for (const answer of notFound) expect.soft(answer.status).toBe(404);
  const streamed = [
    await probe(baseURL!, "/inspections/not-a-uuid", { session: member }),
    await probe(baseURL!, `/inspections/${NOWHERE}/review`, { session: member }),
  ];
  for (const answer of [...notFound, ...streamed]) {
    expect.soft(leaks.test(answer.body), answer.body.slice(0, 200)).toBe(false);
  }
  // A bad action id says nothing either (a cross-site action answers a digest only, see above).
  const unknown = await callAction(baseURL!, { id: `60${"ab".repeat(20)}`, path: "/inspections" }, [], { session: member });
  expect.soft(unknown.status).toBe(404);
  expect.soft(leaks.test(unknown.raw), unknown.raw).toBe(false);
});

test("hostile query strings come back escaped and never break a page", async ({ baseURL }) => {
  const payload = `"><script>alert(1)</script>`;
  const q = encodeURIComponent(payload);
  const probes: [string, Session | null][] = [
    [`/login?error=${q}&next=${q}`, null],
    [`/reset-password?flow=${q}`, null],
    [`/inspections?q=${q}&status=${q}&client=${q}&manufacturer=${q}&page=-7`, member],
    ["/inspections?page=99999999999999999999", member],
    [`/inspections/${fx.inspections.mDraft.id}?module=${q}`, member],
    [`/admin/users?q=${q}`, admin],
    [`/admin/clients?q=${q}`, admin],
    [`/admin/manufacturers?q=${q}`, admin],
    [`/admin/defects?q=${q}&code=${q}&name=${q}`, admin],
    [`/admin/defects/labels?q=${q}`, admin],
    [`/admin/defects/shortforms?q=${q}`, admin],
  ];
  for (const [path, session] of probes) {
    const answer = await probe(baseURL!, path, { session });
    expect.soft(answer.status, path).toBeLessThan(500);
    expect.soft(answer.body.includes("<script>alert(1)</script>"), `${path} echoes markup`).toBe(false);
  }
});

test("session cookies are SameSite=Lax; their other attributes are recorded", async ({ baseURL }) => {
  // Signing out answers with the cookies it clears, carrying the attributes the app sets.
  const out = await callAction(baseURL!, { id: actions.get("signOut")!, path: "/inspections" }, [], { session: pending });
  expect(out.redirect).toBe("/login;push");
  const auth = out.setCookies.filter((cookie) => /^sb-[a-z0-9]+-auth-token/.test(cookie));
  expect(auth.length, out.setCookies.join(" | ")).toBeGreaterThan(0);
  for (const cookie of auth) {
    expect.soft(cookie, "SameSite=Lax keeps cross-site posts and frames without the session").toMatch(/;\s*SameSite=Lax/i);
    expect.soft(cookie).toMatch(/;\s*Path=\//i);
  }
  test.info().annotations.push({ type: "evidence", description: `Set-Cookie on sign-out: ${auth.map((cookie) => cookie.replace(/=[^;]*/, "=<value>")).join(" | ")}` });
});

/* ------------------------------------------------------------------ *
 * Findings of the audit. SEC-01 to SEC-03 are fixed and tested as such;
 * SEC-04 still stands and passes while it does (test.fail).
 * ------------------------------------------------------------------ */

async function adminPage(page: Page, baseURL: string): Promise<void> {
  await page.context().addCookies(admin.cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

test("SEC-01: no other site may frame a page, and no answer announces the framework", async ({ baseURL }) => {
  const answers: [string, Awaited<ReturnType<typeof probe>>][] = [
    ["/login, signed out", await probe(baseURL!, "/login")],
    ["/inspections, signed out (the redirect to sign in)", await probe(baseURL!, "/inspections")],
    ["/inspections, an inspector", await probe(baseURL!, "/inspections", { session: member })],
    ["/admin/users, an admin", await probe(baseURL!, "/admin/users", { session: admin })],
    ["the export, signed out (a Route Handler's 401)", await probe(baseURL!, `/api/inspections/${fx.inspections.mApproved.id}/export`)],
  ];
  for (const [what, answer] of answers) {
    const header = (name: string) => answer.headers.get(name);
    expect.soft(header("content-security-policy"), `${what}: CSP`).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
    expect.soft(header("x-frame-options"), `${what}: X-Frame-Options`).toBe("DENY");
    expect.soft(header("referrer-policy"), `${what}: Referrer-Policy`).toBe("strict-origin-when-cross-origin");
    expect.soft(header("x-content-type-options"), `${what}: X-Content-Type-Options`).toBe("nosniff");
    expect.soft(header("permissions-policy"), `${what}: Permissions-Policy`).toBe("camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
    expect.soft(header("x-powered-by"), `${what}: X-Powered-By`).toBeNull();
  }
});

test("SEC-02: an inspector's own session cannot write invalid data or the computed columns, or submit, through the Data API", async ({ page, baseURL }) => {
  const { inspections: i } = fx;
  const invalid = { modules: { header: { poNo: 12345, inspectionDate: "31/02/2026" }, sampling_plan: { anything: "goes" } }, custom: {} };
  const columns = "status, data, suggested_result, result, lot_numbers, submitted_at, updated_at";
  const before = await service().from("inspections").select(columns).eq("id", i.mBypass.id).single();
  expect(before.data).toMatchObject({ status: "draft", suggested_result: null, result: null, lot_numbers: [], submitted_at: null });

  // The app's own path refuses this data...
  const viaAction = await callAction(baseURL!, { id: actions.get("saveCaptureData")!, path: `/inspections/${i.mBypass.id}` }, [{ inspectionId: i.mBypass.id, data: invalid, baseUpdatedAt: before.data!.updated_at }], { session: member });
  expect(viaAction.result).toMatchObject({ ok: false, reason: "invalid" });

  // ...and so does the Data API, with the same session: no data, no "computed" columns, no submit.
  const direct = await member.client
    .from("inspections")
    .update({ data: invalid, suggested_result: "pass", result: "pass", lot_numbers: ["FORGED"], status: "submitted" })
    .eq("id", i.mBypass.id)
    .select("status, suggested_result, result, submitted_at");
  test.info().annotations.push({ type: "evidence", description: `direct update: ${JSON.stringify(direct)}` });
  expect([direct.error?.code, direct.error?.message], "the database refuses a direct submit or computed columns").toEqual([
    "42501",
    "inspectors save and submit inspections through the app",
  ]);
  expect(direct.data).toBeNull();
  // Invalid data on its own is refused too, not only together with the computed columns and a submit.
  const dataOnly = await member.client.from("inspections").update({ data: invalid }).eq("id", i.mBypass.id).select("id");
  test.info().annotations.push({ type: "evidence", description: `invalid data alone: ${JSON.stringify(dataOnly)}` });
  expect([dataOnly.error?.code, dataOnly.error?.message], "invalid data alone").toEqual(["42501", "inspectors save and submit inspections through the app"]);
  const after = await service().from("inspections").select(columns).eq("id", i.mBypass.id).single();
  expect(after.data, "the row is as it was").toEqual(before.data);

  // An admin finds it still a draft, in the review and in the list.
  await adminPage(page, baseURL!);
  await page.goto(`/inspections/${i.mBypass.id}/review`);
  await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="inspection-status"]').first()).toHaveAttribute("data-status", "draft");
  await page.screenshot({ path: `${SHOTS}/sec-02-review-after-a-refused-submit.png`, fullPage: true });
  await page.goto(`/inspections?q=${encodeURIComponent(i.mBypass.ref)}`);
  const row = page.locator(`tbody tr[data-ref="${i.mBypass.ref}"]`);
  await expect(row.locator('[data-slot="inspection-status"]')).toHaveAttribute("data-status", "draft");
  await page.screenshot({ path: `${SHOTS}/sec-02-list-row-after-a-refused-submit.png`, fullPage: true });
});

test("SEC-03: an inspector cannot add an admin's or the system's events to the audit trail of their own inspection", async ({ page, baseURL }) => {
  const { inspections: i } = fx;
  const forged = [
    { action: "review.reopened", changes: { reason: "Approved by phone, no need to check the weights" } },
    { action: "ai_report.sent", changes: { reportUrl: "https://evil.example/report" } },
    { action: "module_override", changes: { module: "visual", include: false, reason: "Switched off by the admin" } },
  ];
  // On the owner's own draft, which they may still change, only the list of an inspector's
  // events refuses them; on the approved one, that list answers before "can no longer change".
  const answers: unknown[] = [];
  for (const target of [i.mDraft, i.mApproved]) {
    for (const event of forged) {
      const logged = await member.client.rpc("log_inspection_event", { inspection_id: target.id, ...event });
      answers.push(logged.error ? [logged.error.code, logged.error.message] : logged.data);
    }
  }
  test.info().annotations.push({ type: "evidence", description: `answers for ${i.mDraft.ref} and the approved ${i.mApproved.ref}: ${JSON.stringify(answers)}` });
  const refused = forged.map((event) => ["42501", `an inspector cannot record ${event.action}`]);
  expect(answers, "the database refuses each event: not an inspector's to record").toEqual([...refused, ...refused]);
  const trail = await service().from("audit_log").select("action").in("inspection_id", [i.mDraft.id, i.mApproved.id]);
  expect(trail.error).toBeNull();
  const recorded = trail.data!.map((row) => row.action);
  expect(recorded.filter((action) => forged.some((event) => event.action === action)), "no forged row in the audit log").toEqual([]);

  // The history an admin reads shows none of them.
  await adminPage(page, baseURL!);
  await page.goto(`/inspections/${i.mApproved.id}/review`);
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await expect(page.locator("li[data-kind]").first()).toBeVisible();
  for (const text of ["Sent to Steri-AI Report", "Reason for Reopening", "Module Settings Changed for This Inspection", "Approved by phone"]) {
    await expect(page.getByText(text), text).toHaveCount(0);
  }
  await page.screenshot({ path: `${SHOTS}/sec-03-history-without-forged-events.png`, fullPage: true });
});

test("finding SEC-04: a signed-in session sets a new password without the current one", async () => {
  test.fail(true, "SEC-04: Supabase Auth accepts PUT /auth/v1/user { password } from any session (secure_password_change = false)");
  // Lars's throwaway session, with its access token as the browser holds it in the cookie.
  const changed = await lead2.client.auth.updateUser({ password: `E2e-${randomUUID().slice(0, 13)}-7` });
  test.info().annotations.push({ type: "evidence", description: `updateUser({ password }) with a password session: ${changed.error ? `refused (${changed.error.message})` : "accepted"}` });
  expect(changed.error, "the current password or a fresh email link is required").not.toBeNull();
});
