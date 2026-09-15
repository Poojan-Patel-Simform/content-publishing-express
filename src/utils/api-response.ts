import type { Response } from "express";

import { HTTP_STATUS } from "../constants/http-status.js";

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode: number = HTTP_STATUS.OK,
): void => {
  res.status(statusCode).json({ success: true, data });
};

export const sendNoContent = (res: Response): void => {
  res.status(HTTP_STATUS.NO_CONTENT).end();
};
