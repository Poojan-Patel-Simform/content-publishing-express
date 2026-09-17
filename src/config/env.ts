import "dotenv/config";

import { z } from "zod";

const csv = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.url({ error: "CORS_ORIGINS must be a comma-separated list of origins" })));

// Every key is required: the process refuses to start rather than fall back to
// a value baked into the image. Only keys whose absence is a meaningful state
// -- OAuth disabled, no SMTP auth, host-only cookies -- are `.optional()`.
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().positive().max(65535),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    CORS_ORIGINS: csv,

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive(),
    RATE_LIMIT_MAX: z.coerce.number().int().positive(),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive(),

    BODY_LIMIT: z.string().min(1),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive(),

    // --- Content publishing ---
    // Clock-skew allowance for "scheduledFor must be in the future".
    SCHEDULE_MIN_LEAD_MS: z.coerce.number().int().positive(),

    // --- App / URLs ---
    APP_NAME: z.string().min(1),
    FRONTEND_URL: z.url(),
    API_PUBLIC_URL: z.url(),
    // A hop count, not a boolean: express-rate-limit v8 refuses a permissive
    // `true`, and a permissive setting lets any client spoof X-Forwarded-For.
    TRUST_PROXY: z.coerce.number().int().min(0).max(10),

    // --- JWT ---
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    ACCESS_TOKEN_TTL_S: z.coerce.number().int().positive(),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive(),
    REFRESH_REUSE_GRACE_MS: z.coerce.number().int().nonnegative(),

    // --- Cookies ---
    COOKIE_SECURE: z.stringbool(),
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]),
    // Unset means a host-only cookie, which is the safer default.
    COOKIE_DOMAIN: z.string().optional(),

    // --- Password / token lifetimes ---
    PASSWORD_MIN_LENGTH: z.coerce.number().int().positive(),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive(),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive(),

    // --- OAuth (unset = provider disabled) ---
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALLBACK_URL: z.string().min(1).optional(),
    OAUTH_STATE_TTL_MS: z.coerce.number().int().positive(),

    // --- Mail ---
    MAIL_TRANSPORT: z.enum(["smtp", "log"]),
    MAIL_FROM: z.string().min(1),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: z.stringbool(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // --- Jobs ---
    SESSION_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive(),

    // --- Scheduled publishing (BullMQ) ---
    REDIS_URL: z.string().min(1),
    SCHEDULER_ENABLED: z.stringbool(),
    SCHEDULER_CONCURRENCY: z.coerce.number().int().positive(),
    SCHEDULER_MAX_ATTEMPTS: z.coerce.number().int().positive(),
    SCHEDULER_BACKOFF_MS: z.coerce.number().int().positive(),
    SCHEDULER_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production") {
      if (!value.COOKIE_SECURE) {
        ctx.addIssue({
          code: "custom",
          path: ["COOKIE_SECURE"],
          message: "COOKIE_SECURE must be true in production",
        });
      }
      if (value.COOKIE_SAMESITE === "none" && !value.COOKIE_SECURE) {
        ctx.addIssue({
          code: "custom",
          path: ["COOKIE_SAMESITE"],
          message: "COOKIE_SAMESITE=none requires COOKIE_SECURE=true",
        });
      }
    }

    if (value.MAIL_TRANSPORT === "smtp") {
      if (!value.SMTP_HOST) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_HOST"],
          message: "SMTP_HOST is required when MAIL_TRANSPORT=smtp",
        });
      }
      // A relay that authenticates (Mailtrap, SES, Postmark) needs both halves;
      // an open local relay like mailpit needs neither. Half a credential pair
      // is always a misconfiguration, so reject it rather than silently
      // connecting unauthenticated and failing at send time.
      if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASS)) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_USER"],
          message: "SMTP_USER and SMTP_PASS must be set together",
        });
      }
    }

    const googleKeys = [
      value.GOOGLE_CLIENT_ID,
      value.GOOGLE_CLIENT_SECRET,
      value.GOOGLE_CALLBACK_URL,
    ];
    const googleSetCount = googleKeys.filter((key) => key !== undefined).length;
    if (googleSetCount !== 0 && googleSetCount !== googleKeys.length) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message:
          "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL are all-or-nothing",
      });
    }
  });

// Blank means "unset": `.env` keeps commented-out placeholders like
// `GOOGLE_CLIENT_ID=` around, and an empty string should read as absent for
// the optional keys rather than failing validators like `.url()`. A required
// key left blank is reported as missing, which is what it is.
const present = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
);

const parsed = envSchema.safeParse(present);

if (!parsed.success) {
  // Only the offending KEYS and the validation message are printed. Never the
  // values -- these are secrets, and this runs before the logger's redaction.
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

// Narrowed once here so callers get plain strings instead of re-checking each
// of the three keys; the schema already guarantees they are all-or-nothing.
export const googleOAuth =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL
    ? {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackUrl: env.GOOGLE_CALLBACK_URL,
      }
    : null;

export const isGoogleConfigured = googleOAuth !== null;
