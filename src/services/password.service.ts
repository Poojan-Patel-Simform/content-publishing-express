import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

import { ARGON2_OPTIONS } from "../constants/auth.js";

export const hashPassword = (password: string): Promise<string> =>
  argon2Hash(password, ARGON2_OPTIONS);

export const verifyPassword = (passwordHash: string, password: string): Promise<boolean> =>
  argon2Verify(passwordHash, password, ARGON2_OPTIONS);
