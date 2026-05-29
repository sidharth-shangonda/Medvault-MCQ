import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { listImageAuditQueue, updateImageAudit } from "../repositories/imageAuditRepository.js";

export const imageAuditRouter = Router();

imageAuditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listImageAuditQueue(req.query));
  })
);

imageAuditRouter.patch(
  "/:questionId",
  asyncHandler(async (req, res) => {
    const question = await updateImageAudit(req.params.questionId, req.body || {});
    if (!question) return res.status(404).json({ message: "Question not found" });
    res.json(question);
  })
);
