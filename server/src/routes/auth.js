import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { createUser, loginUser } from "../repositories/userRepository.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    res.status(201).json(await createUser(req.body || {}));
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    res.json(await loginUser(req.body || {}));
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);
