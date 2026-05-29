import fs from "node:fs/promises";
import { config } from "../config.js";

const raw = await fs.readFile(config.questionJsonPath, "utf-8");
const parsed = JSON.parse(raw);
const questions = parsed.questions || [];

const errors = [];
const ids = new Set();
let imageCandidates = 0;

for (const question of questions) {
  if (!question.id) errors.push("Question without id");
  if (ids.has(question.id)) errors.push(`Duplicate id: ${question.id}`);
  ids.add(question.id);
  if (!question.subject) errors.push(`${question.id}: missing subject`);
  if (!question.chapter) errors.push(`${question.id}: missing chapter`);
  if (!question.question) errors.push(`${question.id}: missing stem`);
  if (!Array.isArray(question.options) || question.options.length < 2) errors.push(`${question.id}: missing options`);
  if (typeof question.correct !== "number" || question.correct < 0 || question.correct >= question.options.length) {
    errors.push(`${question.id}: invalid correct answer`);
  }
  const hasImageSignal =
    (question.tags || []).includes("Image-based") ||
    /image|marked|arrow|radiograph|x-ray|ct|mri|ultrasound|histopath|electron micrograph/i.test(question.question || "");
  if (hasImageSignal) imageCandidates += 1;
}

console.log(`Questions: ${questions.length}`);
console.log(`Unique IDs: ${ids.size}`);
console.log(`Image candidates: ${imageCandidates}`);
console.log(`Errors: ${errors.length}`);

for (const error of errors.slice(0, 50)) {
  console.log(`- ${error}`);
}

if (errors.length) process.exit(1);
