import fs from "node:fs/promises";
import mongoose from "mongoose";
import { config } from "../config.js";
import { connectDatabase, getDatabaseMode } from "../db.js";
import { Question } from "../models/Question.js";

let exitCode = 0;

try {
  await connectDatabase();

  if (getDatabaseMode() !== "mongo") {
    console.error("MONGODB_URI is required for import:questions.");
    exitCode = 1;
  } else {
    const raw = await fs.readFile(config.questionJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    const questions = parsed.questions || [];

    let imported = 0;
    for (const question of questions) {
      await Question.findOneAndUpdate({ id: question.id }, question, { upsert: true, setDefaultsOnInsert: true });
      imported += 1;
      if (imported % 500 === 0) console.log(`Imported ${imported}/${questions.length}`);
    }

    console.log(`Imported ${imported} questions into MongoDB.`);
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}

if (exitCode) process.exit(exitCode);
