import { getUserFromToken } from "../repositories/userRepository.js";

export async function requireAuth(req, _res, next) {
  try {
    const header = req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const user = await getUserFromToken(token);
    if (!user) {
      const error = new Error("Authentication required");
      error.status = 401;
      throw error;
    }
    req.user = user;
    next();
  } catch (err) {
    err.status = err.status || 401;
    next(err);
  }
}
