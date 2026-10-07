import { expect, isTouch, onlyIn, open, press, shot, test } from "./support";

// The sign-in screens as a signed-out visitor sees them, at every size. Nothing
// here reaches Supabase Auth (validation runs before any call), except where
// onlyIn() says so. Alerts are looked up inside <main>: Next.js adds its own
// role="alert" route announcer to every page.

test.describe("/login", () => {
  test("email and password, a way to reset, no sign-up", async ({ page }, testInfo) => {
    await open(page, "/login");

    await expect(page.getByRole("heading", { level: 1, name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("img", { name: "SteriCare" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByRole("link", { name: "Forgot Password?" })).toHaveAttribute("href", "/forgot-password");
    await expect(page.getByText(/sign up|register|create an account/i)).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveText("SteriCare Sdn. Bhd.");
    await shot(page, testInfo, "login");

    // Show / hide: one named toggle button that reports its state.
    const toggle = page.getByRole("button", { name: "Show Password" });
    await password.fill("not-a-real-password-1");
    await press(toggle, testInfo);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    await shot(page, testInfo, "login-password-shown");
    await press(toggle, testInfo);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(password).toHaveAttribute("type", "password");
  });

  test("controls are at least 44 px on iPad", async ({ page }, testInfo) => {
    test.skip(!isTouch(testInfo), "touch sizes only apply with a coarse pointer");
    await open(page, "/login");

    for (const target of [
      page.getByLabel("Email"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("link", { name: "Forgot Password?" }),
      page.getByRole("button", { name: "Sign In" }),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height, await target.evaluate((element) => element.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
    // The eye button is 36 px with an invisible 4 px ring of extra hit area (input-group.tsx).
    const toggle = await page.getByRole("button", { name: "Show Password" }).boundingBox();
    expect(toggle?.height).toBeGreaterThanOrEqual(36);
    // 16 px field text, so iPad Safari does not zoom in on focus.
    await expect(page.getByLabel("Email")).toHaveCSS("font-size", "16px");
  });

  test("checks the fields before calling Supabase", async ({ page }, testInfo) => {
    await open(page, "/login");
    await press(page.getByRole("button", { name: "Sign In" }), testInfo);

    const email = page.getByLabel("Email");
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAttribute("aria-describedby", "login-email-error");
    await expect(email).toBeFocused();
    await shot(page, testInfo, "login-empty");

    await email.fill("inspector");
    await page.getByLabel("Password", { exact: true }).fill("anything");
    await press(page.getByRole("button", { name: "Sign In" }), testInfo);
    await expect(page.getByText("Enter a valid email address, like name@example.com.")).toBeVisible();
    await expect(email).toHaveValue("inspector");
    await shot(page, testInfo, "login-invalid-email");
  });

  test("the button shows progress while the form is sent", async ({ page }, testInfo) => {
    await open(page, "/login");
    // Hold the Server Action request (a POST to /login) until the screenshot is taken.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/login*", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });

    // An invalid email: the action answers without calling Supabase.
    await page.getByLabel("Email").fill("inspector");
    await page.getByLabel("Password", { exact: true }).fill("anything");
    await press(page.getByRole("button", { name: "Sign In" }), testInfo);
    await expect(page.getByRole("button", { name: "Signing In…" })).toBeDisabled();
    await shot(page, testInfo, "login-pending");

    release();
    await expect(page.getByText("Enter a valid email address, like name@example.com.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });

  test("Enter in the email field moves on to the password", async ({ page }) => {
    await open(page, "/login");
    await page.getByLabel("Email").fill("inspector@test.local");
    await page.getByLabel("Email").press("Enter");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("Tab goes from the email straight to the password", async ({ page }) => {
    // Email, Tab, password, Enter: "Forgot Password?" sits in the label row
    // but must not take the focus (and the typed password) before the field.
    await open(page, "/login");
    const password = page.getByLabel("Password", { exact: true });
    await page.getByLabel("Email").fill("inspector@test.local");
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    await page.keyboard.type("typed-after-tab-1");
    await expect(password).toHaveValue("typed-after-tab-1");

    for (const next of [
      page.getByRole("button", { name: "Show Password" }),
      page.getByRole("link", { name: "Forgot Password?" }),
      page.getByRole("button", { name: "Sign In" }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
    }
    await expect(page).toHaveURL(/\/login$/);
  });

  for (const [code, text] of [
    ["deactivated", "This account has been deactivated. Ask your SteriCare administrator."],
    ["link_invalid", "That link has expired or was already used."],
    ["session_expired", "Your session has ended. Sign in again."],
  ] as const) {
    test(`?error=${code} shows its banner`, async ({ page }, testInfo) => {
      await open(page, `/login?error=${code}`);
      await expect(page.getByText(text)).toBeVisible();
      await shot(page, testInfo, `login-error-${code}`);
    });
  }

  test("the ?error= banner goes once the user tries again", async ({ page }, testInfo) => {
    await open(page, "/login?error=link_invalid");
    const banner = page.getByText("That link has expired or was already used.");
    await expect(banner).toBeVisible();
    // An empty submit is answered without calling Supabase.
    await press(page.getByRole("button", { name: "Sign In" }), testInfo);
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test("unknown ?error= codes show nothing", async ({ page }) => {
    await open(page, "/login?error=Your%20account%20is%20locked.%20Call%20us");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Call us")).toHaveCount(0);
  });

  test("a protected page sends a signed-out visitor here with ?next=", async ({ page }) => {
    await open(page, "/inspections?status=draft");
    await expect(page).toHaveURL(/\/login\?next=%2Finspections%3Fstatus%3Ddraft$/);
    await expect(page.locator('input[name="next"]')).toHaveValue("/inspections?status=draft");
  });
});

test.describe("/forgot-password", () => {
  test("asks for the email", async ({ page }, testInfo) => {
    await open(page, "/forgot-password");
    await expect(page.getByRole("heading", { level: 1, name: "Reset Your Password" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByRole("link", { name: "Back to Sign In" })).toHaveAttribute("href", "/login");
    await shot(page, testInfo, "forgot-password");
  });

  test("checks the email before calling Supabase", async ({ page }, testInfo) => {
    await open(page, "/forgot-password");
    await page.getByLabel("Email").fill("inspector");
    await press(page.getByRole("button", { name: "Send Reset Link" }), testInfo);
    await expect(page.getByText("Enter a valid email address, like name@example.com.")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
    await shot(page, testInfo, "forgot-password-invalid");
  });

  test("the link from /login gets here", async ({ page }, testInfo) => {
    await open(page, "/login");
    await press(page.getByRole("link", { name: "Forgot Password?" }), testInfo);
    await expect(page).toHaveURL(/\/forgot-password$/);
    await press(page.getByRole("link", { name: "Back to Sign In" }), testInfo);
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("/reset-password", () => {
  for (const flow of ["recovery", "invite"]) {
    test(`without a session (?flow=${flow}) the link has expired`, async ({ page }, testInfo) => {
      await open(page, `/reset-password?flow=${flow}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "This Link Has Expired or Was Already Used" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Get a New Link" })).toHaveAttribute("href", "/forgot-password");
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page).toHaveTitle("Link Expired · SteriCare QC");
      if (flow === "recovery") await shot(page, testInfo, "reset-password-expired");
    });
  }

  test("an invalid email link lands on /login with the expired-link banner", async ({ page }, testInfo) => {
    onlyIn(testInfo, "desktop");
    await open(page, "/auth/confirm?token_hash=not-a-real-token&type=recovery");
    await expect(page).toHaveURL(/\/login\?error=link_invalid$/);
    await expect(page.getByText("That link has expired or was already used.")).toBeVisible();
    await press(page.getByRole("link", { name: "Get a New Reset Link" }), testInfo);
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});
