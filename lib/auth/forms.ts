import { z } from "zod";

/**
 * The sign-in screens' contract (BUILD_SPEC 3, 10): zod schemas for the three
 * forms, the state their Server Actions return, and every message they show.
 * Client-safe: the forms import the same rules the actions enforce.
 */

// ---- Password policy -------------------------------------------------------

/** supabase/config.toml: minimum_password_length = 10. */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt, which Supabase Auth uses, reads at most 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_POLICY = "At least 10 characters, with letters and digits.";

const utf8 = new TextEncoder();

/**
 * supabase/config.toml: password_requirements = "letters_digits", which Supabase
 * Auth checks as at least one ASCII letter and one ASCII digit.
 */
export const PASSWORD_RULES = [
  {
    key: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (value: string) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    key: "mix",
    label: "Letters and digits",
    test: (value: string) => /[A-Za-z]/.test(value) && /[0-9]/.test(value),
  },
] as const;

// ---- Messages --------------------------------------------------------------

export const MESSAGES = {
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter a valid email address, like name@example.com.",
  emailTooLong: "That email address is too long.",
  passwordRequired: "Enter your password.",
  newPasswordRequired: "Enter a new password.",
  passwordTooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  passwordNeedsMix: "Use both letters and digits.",
  passwordTooLong: "Use 72 characters or fewer.",
  confirmRequired: "Type the new password again.",
  confirmMismatch: "The passwords do not match.",

  invalidCredentials: "Email or password is incorrect.",
  deactivated: "This account has been deactivated. Ask your SteriCare administrator.",
  signInRateLimited: "Too many sign-in attempts. Wait a few minutes, then try again.",
  serviceUnavailable: "Sign-in is not available right now. Try again in a minute.",
  profileCheckFailed: "We could not check your account. Try again in a minute.",
  notConfigured: "Sign-in is not set up yet: connect Supabase in .env.local (see README.md).",

  resetSent: "If an account exists for that email, a reset link is on its way.",
  resetRateLimited: "Too many requests. Wait a few minutes, then try again.",

  linkExpired: "This link has expired or was already used.",
  linkSessionRequired:
    "Passwords are set from an invite or reset link opened in the last hour. Sign out, then choose “Forgot password?”.",
  samePassword: "That is your current password. Choose a new one.",
  pwnedPassword: "This password has appeared in a data breach. Choose a different one.",
  weakPassword: "Choose a stronger password: make it longer and mix letters, digits and symbols.",
  updateRateLimited: "Too many attempts. Wait a few minutes, then try again.",
  updateFailed: "Your password was not saved. Try again.",
} as const;

// ---- Schemas ---------------------------------------------------------------

/** Trimmed and lower-cased, as Supabase Auth stores it. */
export const EmailSchema = z
  .string({ error: MESSAGES.emailRequired })
  .trim()
  .min(1, { error: MESSAGES.emailRequired })
  .max(254, { error: MESSAGES.emailTooLong })
  .pipe(z.email({ error: MESSAGES.emailInvalid }))
  .transform((email) => email.toLowerCase());

/**
 * A new password, held to the project's policy. Never trimmed: spaces are
 * characters like any other.
 */
export const NewPasswordSchema = z
  .string({ error: MESSAGES.newPasswordRequired })
  .min(1, { error: MESSAGES.newPasswordRequired })
  .min(PASSWORD_MIN_LENGTH, { error: MESSAGES.passwordTooShort })
  .refine(PASSWORD_RULES[1].test, { error: MESSAGES.passwordNeedsMix })
  .refine((value) => utf8.encode(value).length <= PASSWORD_MAX_BYTES, { error: MESSAGES.passwordTooLong });

/**
 * Signing in only needs a password to be there: accounts made before the policy
 * (Kenneth's first admin, from the dashboard) must still get in. `next` is
 * checked again by safeNextPath before anyone is sent there.
 */
export const SignInSchema = z.object({
  email: EmailSchema,
  password: z
    .string({ error: MESSAGES.passwordRequired })
    .min(1, { error: MESSAGES.passwordRequired })
    .max(1024, { error: MESSAGES.invalidCredentials }),
  next: z.string().max(2048).nullish().catch(null),
});

export const ForgotPasswordSchema = z.object({
  email: EmailSchema,
});

export const ResetPasswordSchema = z
  .object({
    password: NewPasswordSchema,
    confirm: z.string({ error: MESSAGES.confirmRequired }).min(1, { error: MESSAGES.confirmRequired }),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    error: MESSAGES.confirmMismatch,
  });

/** The first message for each field, keyed by field name. */
export function fieldErrors<Field extends string>(error: z.ZodError): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in errors)) errors[field as Field] = issue.message;
  }
  return errors;
}

// ---- Form state (what each Server Action returns) --------------------------

type FormState<Field extends string> = {
  /** Counts submissions, so a repeated message is announced again. */
  attempt: number;
  /** Form-level problem, shown above the fields. */
  message?: string;
  fieldErrors?: Partial<Record<Field, string>>;
};

export type SignInField = "email" | "password";
export type SignInState = FormState<SignInField> & {
  status: "idle" | "error";
  /** The email as typed, so it survives a failed attempt. Never the password. */
  email?: string;
};

export type ForgotPasswordState = FormState<"email"> & {
  status: "idle" | "error" | "sent";
  email?: string;
};

export type ResetPasswordField = "password" | "confirm";
export type ResetPasswordState = FormState<ResetPasswordField> & {
  status: "idle" | "error";
  /** The session behind the email link is gone: offer a new link. */
  expired?: boolean;
};

export const INITIAL_SIGN_IN_STATE: SignInState = { status: "idle", attempt: 0 };
export const INITIAL_FORGOT_PASSWORD_STATE: ForgotPasswordState = { status: "idle", attempt: 0 };
export const INITIAL_RESET_PASSWORD_STATE: ResetPasswordState = { status: "idle", attempt: 0 };

// ---- Banners on /login (?error=<code>) -------------------------------------

export type NoticeTone = "error" | "warning" | "info";

export type LoginNotice = {
  tone: NoticeTone;
  title: string;
  description?: string;
  action?: { href: string; label: string };
};

/**
 * Codes other screens may send to /login. Unknown codes show nothing, so a
 * crafted link cannot put words on the sign-in screen.
 */
export const LOGIN_NOTICES = {
  // /auth/sign-out?reason=deactivated
  deactivated: {
    tone: "error",
    title: MESSAGES.deactivated,
  },
  // /auth/confirm, when an invite or reset link fails
  link_invalid: {
    tone: "warning",
    title: "That link has expired or was already used.",
    description:
      "Links work once and expire after a short time. Ask for a new one, or ask your administrator to resend your invite.",
    action: { href: "/forgot-password", label: "Get a new reset link" },
  },
  session_expired: {
    tone: "info",
    title: "Your session has ended. Sign in again.",
  },
} as const satisfies Record<string, LoginNotice>;

export type LoginNoticeCode = keyof typeof LOGIN_NOTICES;

const LoginNoticeCodeSchema = z.enum(Object.keys(LOGIN_NOTICES) as [LoginNoticeCode, ...LoginNoticeCode[]]);

/** The banner for a ?error= value, or null for a missing or unknown code. */
export function loginNotice(raw: string | string[] | undefined): LoginNotice | null {
  const code = LoginNoticeCodeSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return code.success ? LOGIN_NOTICES[code.data] : null;
}

// ---- /reset-password?flow= -------------------------------------------------

/** /auth/confirm sends invites and resets to the same screen; flow picks its words. */
export type PasswordFlow = "invite" | "recovery";

export function passwordFlow(raw: string | string[] | undefined): PasswordFlow {
  return (Array.isArray(raw) ? raw[0] : raw) === "invite" ? "invite" : "recovery";
}
