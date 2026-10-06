import { describe, expect, it } from "vitest";
import {
  EmailSchema,
  fieldErrors,
  ForgotPasswordSchema,
  LOGIN_NOTICES,
  loginNotice,
  MESSAGES,
  NewPasswordSchema,
  PASSWORD_RULES,
  passwordFlow,
  ResetPasswordSchema,
  SignInSchema,
} from "./forms";

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : result.error?.issues[0]?.message;
}

describe("EmailSchema", () => {
  it("trims and lower-cases, as Supabase Auth stores addresses", () => {
    expect(EmailSchema.parse("  Inspector@Test.Local ")).toBe("inspector@test.local");
  });

  it.each([
    [null, MESSAGES.emailRequired],
    [undefined, MESSAGES.emailRequired],
    ["", MESSAGES.emailRequired],
    ["   ", MESSAGES.emailRequired],
    ["inspector", MESSAGES.emailInvalid],
    ["inspector@", MESSAGES.emailInvalid],
    ["inspector@test", MESSAGES.emailInvalid],
    ["two words@test.local", MESSAGES.emailInvalid],
    [`${"a".repeat(250)}@test.local`, MESSAGES.emailTooLong],
  ])("rejects %j with one plain message", (value, message) => {
    const result = EmailSchema.safeParse(value);
    expect(firstMessage(result)).toBe(message);
  });
});

describe("NewPasswordSchema (supabase/config.toml: 10 characters, letters_digits)", () => {
  it.each(["Glove-check-2026", "abcdefghi1", "1234567890a", "with spaces 9 ok", "ÄÖÜäöü-mix-9a"])("accepts %j", (value) => {
    expect(NewPasswordSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["", MESSAGES.newPasswordRequired],
    [null, MESSAGES.newPasswordRequired],
    ["abc123", MESSAGES.passwordTooShort],
    ["abcdefghi", MESSAGES.passwordTooShort],
    ["abcdefghij", MESSAGES.passwordNeedsMix],
    ["1234567890", MESSAGES.passwordNeedsMix],
    ["ÄÖÜäöüßéèê1", MESSAGES.passwordNeedsMix],
    [`a1${"x".repeat(71)}`, MESSAGES.passwordTooLong],
    [`a1${"é".repeat(36)}`, MESSAGES.passwordTooLong],
  ])("rejects %j: %s", (value, message) => {
    expect(firstMessage(NewPasswordSchema.safeParse(value))).toBe(message);
  });

  it("never trims: leading and trailing spaces are part of the password", () => {
    expect(NewPasswordSchema.parse("  pad-me-9  ")).toBe("  pad-me-9  ");
  });

  it("matches the live checklist on the reset screen", () => {
    for (const value of ["", "short1", "abcdefghij", "abcdefghi1", "Glove-check-2026"]) {
      const allMet = PASSWORD_RULES.every((rule) => rule.test(value));
      expect(NewPasswordSchema.safeParse(value).success).toBe(allMet);
    }
  });
});

describe("SignInSchema", () => {
  it("accepts any non-empty password: older accounts predate the policy", () => {
    const parsed = SignInSchema.parse({ email: "Admin@Test.Local", password: "short", next: "/inspections" });
    expect(parsed).toEqual({ email: "admin@test.local", password: "short", next: "/inspections" });
  });

  it("asks for both fields", () => {
    const result = SignInSchema.safeParse({ email: "", password: "", next: null });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toEqual({ email: MESSAGES.emailRequired, password: MESSAGES.passwordRequired });
  });

  it("drops a missing or oversized next instead of failing", () => {
    expect(SignInSchema.parse({ email: "a@b.co", password: "x", next: null }).next).toBeNull();
    expect(SignInSchema.parse({ email: "a@b.co", password: "x", next: `/${"a".repeat(3000)}` }).next).toBeNull();
  });
});

describe("ForgotPasswordSchema", () => {
  it("needs a valid email", () => {
    expect(ForgotPasswordSchema.parse({ email: " Kenneth@Example.com " })).toEqual({ email: "kenneth@example.com" });
    expect(firstMessage(ForgotPasswordSchema.safeParse({ email: "kenneth" }))).toBe(MESSAGES.emailInvalid);
  });
});

describe("ResetPasswordSchema", () => {
  it("accepts a valid password typed twice", () => {
    expect(ResetPasswordSchema.safeParse({ password: "Glove-check-2026", confirm: "Glove-check-2026" }).success).toBe(
      true,
    );
  });

  it("flags a mismatch on the confirmation field", () => {
    const result = ResetPasswordSchema.safeParse({ password: "Glove-check-2026", confirm: "Glove-check-2027" });
    expect(fieldErrors(result.error!)).toEqual({ confirm: MESSAGES.confirmMismatch });
  });

  it("reports one message per field, the most useful first", () => {
    const result = ResetPasswordSchema.safeParse({ password: "abc", confirm: "" });
    expect(fieldErrors(result.error!)).toEqual({
      password: MESSAGES.passwordTooShort,
      confirm: MESSAGES.confirmRequired,
    });
  });

  it("asks for a password when nothing was sent", () => {
    const result = ResetPasswordSchema.safeParse({ password: null, confirm: null });
    expect(fieldErrors(result.error!)).toEqual({
      password: MESSAGES.newPasswordRequired,
      confirm: MESSAGES.confirmRequired,
    });
  });
});

describe("loginNotice", () => {
  it.each(Object.keys(LOGIN_NOTICES))("shows the banner for ?error=%s", (code) => {
    expect(loginNotice(code)).toBe(LOGIN_NOTICES[code as keyof typeof LOGIN_NOTICES]);
  });

  it("uses the exact deactivated and expired-link wording", () => {
    expect(loginNotice("deactivated")?.title).toBe(
      "This account has been deactivated. Ask your SteriCare administrator.",
    );
    expect(loginNotice("link_invalid")?.title).toBe("That link has expired or was already used.");
  });

  it.each([[undefined], [""], ["unknown"], ["<script>"], ["toString"], ["__proto__"], ["Deactivated"]])(
    "ignores %j",
    (code) => {
      expect(loginNotice(code)).toBeNull();
    },
  );

  it("reads the first value when the code is repeated", () => {
    expect(loginNotice(["link_invalid", "deactivated"])).toBe(LOGIN_NOTICES.link_invalid);
  });
});

describe("passwordFlow", () => {
  it("picks the invite wording only for ?flow=invite", () => {
    expect(passwordFlow("invite")).toBe("invite");
    expect(passwordFlow(["invite"])).toBe("invite");
    expect(passwordFlow("recovery")).toBe("recovery");
    expect(passwordFlow(undefined)).toBe("recovery");
    expect(passwordFlow("anything")).toBe("recovery");
  });
});
