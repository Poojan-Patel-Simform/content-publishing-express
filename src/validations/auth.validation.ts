import { z } from "zod";

import { env } from "../config/env.js";

// Normalised once at the edge, so the `users_email_lower_key` index only has
// to agree with a single canonical form written by every caller.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const registerSchema = z.object({
  email: emailSchema,
  // Length-only, per NIST SP 800-63B: composition rules push people toward
  // predictable substitutions, and the max bounds Argon2's work.
  password: z.string().min(env.PASSWORD_MIN_LENGTH).max(128),
  displayName: z.string().trim().min(1).max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not the policy length -- applying it here would tell an unauthenticated
  // attacker the password policy.
  password: z.string().min(1),
});

export const emailOnlySchema = z.object({
  email: emailSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(env.PASSWORD_MIN_LENGTH).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(env.PASSWORD_MIN_LENGTH).max(128),
});
