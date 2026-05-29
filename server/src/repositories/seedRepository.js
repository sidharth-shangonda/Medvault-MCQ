import fs from "node:fs/promises";
import { config } from "../config.js";
import { getDatabaseMode } from "../db.js";
import { Question } from "../models/Question.js";

export async function seedQuestionsIfNeeded() {
  if (getDatabaseMode() !== "mongo" || !config.autoSeedQuestions) return { skipped: true };

  const existing = await Question.estimatedDocumentCount();
  if (existing > 0) return { skipped: true, existing };

  const raw = await fs.readFile(config.questionJsonPath, "utf-8");
  const questions = JSON.parse(raw).questions || [];
  if (!questions.length) return { skipped: true, existing: 0 };

  const batchSize = 500;
  let imported = 0;
  for (let index = 0; index < questions.length; index += batchSize) {
    const batch = questions.slice(index, index + batchSize);
    await Question.bulkWrite(
      batch.map(question => ({
        updateOne: {
          filter: { id: question.id },
          update: { $set: question },
          upsert: true
        }
      })),
      { ordered: false }
    );
    imported += batch.length;
  }

  return { skipped: false, imported };
}
