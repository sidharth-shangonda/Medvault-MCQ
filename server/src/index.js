import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { connectDatabase, getDatabaseMode } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { questionsRouter } from "./routes/questions.js";
import { progressRouter } from "./routes/progress.js";
import { imageAuditRouter } from "./routes/imageAudit.js";
import { seedQuestionsIfNeeded } from "./repositories/seedRepository.js";

const app = express();

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/assets", express.static("assets"));
app.use("/api/auth", authRouter);
app.use("/api/questions", questionsRouter);
app.use("/api/progress", progressRouter);
app.use("/api/image-audit", imageAuditRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: getDatabaseMode() });
});

const clientDistDir = path.join(config.rootDir, "dist");
const clientIndexPath = path.join(clientDistDir, "index.html");

if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientDistDir));
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (!req.accepts("html")) return next();
    res.sendFile(clientIndexPath);
  });
}

app.use((err, _req, res, _next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error"
  });
});

try {
  await connectDatabase();
  const seedResult = await seedQuestionsIfNeeded();
  if (seedResult.imported) console.log(`Seeded ${seedResult.imported} questions into MongoDB.`);
  app.listen(config.port, () => {
    console.log(`MedVault API listening on http://localhost:${config.port} (${getDatabaseMode()} mode)`);
  });
} catch (err) {
  console.error("MedVault could not connect to MongoDB Atlas.");
  console.error(err.message || err);
  console.error("Fix Atlas Network Access / credentials, or run `npm run start:file` for UI-only local mode.");
  process.exit(1);
}
