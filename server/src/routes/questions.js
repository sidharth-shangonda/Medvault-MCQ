import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { findQuestions, getQuestionById, getQuestionMeta, sampleQuestions } from "../repositories/questionRepository.js";

export const questionsRouter = Router();

questionsRouter.get(
  "/meta",
  asyncHandler(async (_req, res) => {
    res.json(await getQuestionMeta());
  })
);

questionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await findQuestions(req.query));
  })
);

questionsRouter.get(
  "/sample",
  asyncHandler(async (req, res) => {
    res.json({
      items: await sampleQuestions(req.query, req.query.count || 20)
    });
  })
);

questionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const question = await getQuestionById(req.params.id);
    if (!question) return res.status(404).json({ message: "Question not found" });
    res.json(question);
  })
);
