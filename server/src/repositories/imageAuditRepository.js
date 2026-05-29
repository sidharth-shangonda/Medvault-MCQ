import fs from "node:fs/promises";
import path from "node:path";
import { getDatabaseMode } from "../db.js";
import { config } from "../config.js";
import { Question } from "../models/Question.js";
import { findQuestions, getQuestionById, resetFileCache } from "./questionRepository.js";

const auditPath = path.resolve(config.rootDir, "data/image-audit.json");
let auditCache = null;

async function loadAudit() {
  if (auditCache) return auditCache;
  try {
    auditCache = JSON.parse(await fs.readFile(auditPath, "utf-8"));
  } catch {
    auditCache = {};
  }
  return auditCache;
}

async function saveAudit() {
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.writeFile(auditPath, JSON.stringify(auditCache || {}, null, 2));
}

export async function listImageAuditQueue(query = {}) {
  const status = query.status || "pending";
  const limit = Math.min(Number(query.limit || 50), 200);
  const skip = Math.max(Number(query.skip || 0), 0);

  if (getDatabaseMode() === "mongo") {
    const filter = {
      $or: [
        { "images.0": { $exists: true } },
        { "sourceMedia.0": { $exists: true } },
        { tags: "Image-based" }
      ]
    };
    if (status !== "all") filter["imageAudit.status"] = status;
    const [items, total] = await Promise.all([
      Question.find(filter).sort({ subject: 1, year: -1, questionNo: 1 }).skip(skip).limit(limit).lean(),
      Question.countDocuments(filter)
    ]);
    return { items, total, limit, skip };
  }

  const audit = await loadAudit();
  const { items } = await findQuestions({ imageOnly: true }, { limit: 5000, maxLimit: 5000 });
  const mapped = items.map(item => ({
    ...item,
    imageAudit: audit[item.id] || item.imageAudit || { status: "pending", note: "", verifiedImages: [] }
  }));
  const filtered = status === "all" ? mapped : mapped.filter(item => (item.imageAudit?.status || "pending") === status);
  return { items: filtered.slice(skip, skip + limit), total: filtered.length, limit, skip };
}

export async function updateImageAudit(questionId, patch) {
  const allowed = new Set(["pending", "verified", "needs_fix", "not_image_based"]);
  const status = allowed.has(patch.status) ? patch.status : "pending";
  const note = String(patch.note || "");
  const verifiedImages = Array.isArray(patch.verifiedImages) ? patch.verifiedImages : [];
  const update = {
    status,
    note,
    verifiedImages,
    updatedAt: new Date()
  };

  if (getDatabaseMode() === "mongo") {
    const question = await Question.findOneAndUpdate(
      { id: questionId },
      { $set: { imageAudit: update } },
      { new: true }
    ).lean();
    return question;
  }

  const question = await getQuestionById(questionId);
  if (!question) return null;
  const audit = await loadAudit();
  audit[questionId] = update;
  await saveAudit();
  resetFileCache();
  return { ...question, imageAudit: update };
}
