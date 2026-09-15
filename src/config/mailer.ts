import nodemailer, { type Transporter } from "nodemailer";

import { env } from "./env.js";

/** Only constructed when `MAIL_TRANSPORT=smtp`. In `log` mode `mailer.service`
 * never touches this and prints to pino instead, so there is no live
 * connection to fail when no SMTP server is running. */
export const createSmtpTransport = (): Transporter =>
  nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // Omitted entirely for unauthenticated local relays; env validation
    // guarantees the pair is either both set or both empty.
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
