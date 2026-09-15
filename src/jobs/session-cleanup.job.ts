import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as verificationTokenRepository from "../repositories/verification-token.repository.js";

let interval: NodeJS.Timeout | undefined;

const runCleanup = async (): Promise<void> => {
  const now = new Date();

  try {
    const [sessions, tokens] = await Promise.all([
      sessionRepository.deleteExpired(now),
      verificationTokenRepository.deleteExpired(now),
    ]);
    logger.info({ sessions: sessions.count, tokens: tokens.count }, "Session cleanup ran");
  } catch (err) {
    logger.error({ err }, "Session cleanup failed");
  }
};

export const startSessionCleanup = (): void => {
  if (interval) return;
  interval = setInterval(() => void runCleanup(), env.SESSION_CLEANUP_INTERVAL_MS);
  interval.unref();
};

export const stopSessionCleanup = (): void => {
  if (interval) clearInterval(interval);
  interval = undefined;
};
