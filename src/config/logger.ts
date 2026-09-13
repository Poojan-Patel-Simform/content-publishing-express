import { pino } from "pino";

import { env, isProduction } from "./env.js";

/**
 * Paths scrubbed before anything reaches a log sink. Unredacted credentials in
 * logs are one of the most common ways secrets escape an application, so this
 * list should grow alongside any new sensitive field.
 */
const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "*.password",
  "newPassword",
  "currentPassword",
  "token",
  "*.token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: "[Redacted]",
  },
  base: { env: env.NODE_ENV },
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,env" },
        },
      }),
});
