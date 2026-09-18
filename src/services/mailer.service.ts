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

  try {
    // `text` is deliberately omitted: it carries the verification/reset link,
    // which is a bearer credential and must not reach a log sink.
    const info = await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
    logger.info({ to, subject, messageId: info.messageId }, "Mail sent (smtp transport)");
  } catch (error) {
    logger.error({ err: error, to, subject }, "Mail send failed (smtp transport)");
    throw error;
  }
};

export const sendVerificationEmail = (to: string, token: string): Promise<void> => {
  const url = `${env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return send(to, "Verify your email address", `Verify your email: ${url}`);
};

export const sendPasswordResetEmail = (to: string, token: string): Promise<void> => {
  const url = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return send(to, "Reset your password", `Reset your password: ${url}`);
};
