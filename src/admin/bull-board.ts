import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Router } from "express";
import { getQueue } from "../queues/scheduled-publication.queue.js";

export const BULL_BOARD_PATH = "/admin/queues";

export const createBullBoardRouter = (): Router => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(getQueue())],
    serverAdapter,
  });

  const router = Router();
  router.use(serverAdapter.getRouter() as Router);
  return router;
};
