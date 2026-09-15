import type { Algorithm } from "@node-rs/argon2";

/** OWASP's 2024 floor for Argon2id. Shared everywhere a hash is produced or
 * verified, including the dummy hash used to defeat login enumeration --
 * different parameters there would reintroduce the timing signal. */
export const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm, // Argon2id; `Algorithm` is an ambient const enum verbatimModuleSyntax forbids importing as a value.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/** Bytes of CSPRNG output behind every opaque token (refresh token, email
 * verification / password reset links, OAuth state, PKCE verifier). */
export const TOKEN_BYTES = 32;

export const COOKIE_NAMES = {
  ACCESS_TOKEN: "cp_at",
  REFRESH_TOKEN: "cp_rt",
  OAUTH_STATE: "cp_oauth",
} as const;

/** Methods CSRF's origin guard lets through unconditionally. */
export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
