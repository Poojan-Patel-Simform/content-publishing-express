import { createSmtpTransport } from "../config/mailer.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const transport = env.MAIL_TRANSPORT === "smtp" ? createSmtpTransport() : null;

const send = async (to: string, subject: string, text: string): Promise<void> => {
  if (!transport) {
    // Dev/test path: no SMTP relay required. The link is what a real message
    // would deliver, so surfacing it in the log is enough to drive the flow.
    logger.info({ to, subject, text }, "Mail (log transport)");
    return;
  }

  await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
};

export const sendVerificationEmail = (to: string, token: string): Promise<void> => {
  const url = `${env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return send(to, "Verify your email address", `Verify your email: ${url}`);
};

export const sendPasswordResetEmail = (to: string, token: string): Promise<void> => {
  const url = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return send(to, "Reset your password", `Reset your password: ${url}`);
};
