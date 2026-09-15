import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { TOKEN_BYTES } from "../constants/auth.js";

/** A CSPRNG token suitable for a refresh token, an email link, or OAuth state. */
export const generateOpaqueToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");

/** SHA-256 is fine here because the input is already 256 bits of CSPRNG
 * output -- there is nothing to brute-force, and the column must remain an
 * indexable equality lookup. */
export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Constant-time string comparison, for state/PKCE checks where a
 * short-circuiting `===` would leak timing information. */
export const timingSafeEqualStr = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};
