import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { getAnalytics, getReviewQueue, submitSession, toggleBookmark } from "../repositories/progressRepository.js";

export const progressRouter = Router();

progressRouter.use(requireAuth);

progressRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    res.json(await getAnalytics(req.user.id));
  })
);

progressRouter.get(
  "/review",
  asyncHandler(async (req, res) => {
    res.json(await getReviewQueue(req.user.id, req.query.type || "mistakes", req.query.limit || 36));
  })
);

progressRouter.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const session = await submitSession({
      userId: req.user.id,
      mode: req.body.mode || "practice",
      filters: req.body.filters || {},
      answers: req.body.answers || []
    });
    res.status(201).json(session);
  })
);

progressRouter.post(
  "/bookmarks/:questionId",
  asyncHandler(async (req, res) => {
    res.json(await toggleBookmark(req.user.id, req.params.questionId));
  })
);
