import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import { env } from "../config/env.js";
import { AuditAction, AuthProvider } from "../generated/prisma-client/enums.js";
import { BadRequestError } from "../errors/http-errors.js";
import type { AuthUser, OAuthIdentity } from "../interfaces/auth.interface.js";
import * as accountRepository from "../repositories/account.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import * as auditService from "./audit.service.js";

const secretKey = new TextEncoder().encode(env.JWT_SECRET);
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Refused rather than silently taken over: an attacker who pre-registered
 * the victim's address must not inherit the account when the real owner
 * arrives via Google. The oauth controller redirects on this, it never
 * reaches the JSON error middleware. */
export class OAuthAccountExistsUnverifiedError extends Error {}

export interface OAuthState {
  state: string;
  verifier: string;
  returnTo: string;
}

const base64url = (buf: Buffer): string => buf.toString("base64url");

export const generatePkcePair = (): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

export const generateOAuthState = (): string => base64url(randomBytes(32));

export const signOAuthState = (payload: OAuthState): Promise<string> =>
  new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + env.OAUTH_STATE_TTL_MS) / 1000))
    .sign(secretKey);

export const verifyOAuthStateToken = async (token: string): Promise<OAuthState> => {
  const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
  const { state, verifier, returnTo } = payload as Record<string, unknown>;
  if (typeof state !== "string" || typeof verifier !== "string" || typeof returnTo !== "string") {
    throw new BadRequestError("Invalid OAuth state");
  }
  return { state, verifier, returnTo };
};

/** Must start with a single `/`, must not start with `//` (protocol-relative,
 * i.e. an open redirect to another host), and stay short. */
export const isSafeReturnTo = (value: string): boolean =>
  value.length > 0 && value.length <= 256 && value.startsWith("/") && !value.startsWith("//");

export const buildGoogleAuthUrl = (state: string, codeChallenge: string): string => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_CALLBACK_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
};

interface GoogleTokenResponse {
  id_token: string;
}

export const exchangeGoogleCode = async (
  code: string,
  verifier: string,
): Promise<OAuthIdentity> => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new BadRequestError("Failed to exchange authorization code with Google");
  }

  const body = (await response.json()) as GoogleTokenResponse;

  // Redundant with TLS on this direct server-to-server exchange, but it is a
  // handful of lines and removes any doubt.
  const { payload } = await jwtVerify(body.id_token, googleJwks, {
    issuer: "https://accounts.google.com",
    audience: env.GOOGLE_CLIENT_ID,
  });

  if (
    payload.email_verified !== true ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string"
  ) {
    throw new BadRequestError("Google account email is not verified");
  }

  return {
    provider: "GOOGLE",
    providerAccountId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
};

export const resolveGoogleIdentity = async (
  identity: OAuthIdentity,
  requestId: string,
): Promise<AuthUser> => {
  const existingAccount = await accountRepository.findByProviderAccount(
    AuthProvider.GOOGLE,
    identity.providerAccountId,
  );
  if (existingAccount) {
    return userRepository.toAuthUser(existingAccount.user);
  }

  const existingUser = await userRepository.findByEmail(identity.email);
  if (existingUser) {
    if (existingUser.emailVerifiedAt === null) {
      throw new OAuthAccountExistsUnverifiedError();
    }

    await accountRepository.create(
      existingUser.id,
      AuthProvider.GOOGLE,
      identity.providerAccountId,
    );
    await auditService.recordAuditEvent(
      AuditAction.OAUTH_ACCOUNT_LINKED,
      existingUser.id,
      requestId,
    );
    return userRepository.toAuthUser(existingUser);
  }

  const created = await userRepository.create({
    email: identity.email,
    displayName: identity.name ?? identity.email,
    passwordHash: null,
    emailVerifiedAt: new Date(),
    avatarUrl: identity.picture,
  });
  await accountRepository.create(created.id, AuthProvider.GOOGLE, identity.providerAccountId);
  await auditService.recordAuditEvent(AuditAction.USER_REGISTERED, created.id, requestId, {
    metadata: { provider: "GOOGLE" },
  });
  return userRepository.toAuthUser(created);
};
