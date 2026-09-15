import type { UserRole, UserStatus } from "../generated/prisma-client/enums.js";

/** The shape attached to `req.user` by `requireAuth`. Never includes `passwordHash`. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
}

/** What a controller is allowed to send back to a client. */
export type PublicUser = AuthUser;

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: UserRole;
  /** Email-verified flag at the moment the token was issued. */
  ev: boolean;
  typ: "access";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface OAuthIdentity {
  provider: "GOOGLE";
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}
