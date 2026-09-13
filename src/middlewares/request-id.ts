import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * An inbound header is attacker-controlled, so it is only reused when it looks
 * like an id. Echoing arbitrary header content into logs invites log injection
 * and unbounded log lines.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  next();
};
