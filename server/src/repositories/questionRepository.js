import fs from "node:fs/promises";
import { getDatabaseMode } from "../db.js";
import { config } from "../config.js";
import { Question } from "../models/Question.js";

let cachedFileBank = null;
let cachedMeta = null;

async function loadFileBank() {
  if (cachedFileBank) return { questions: cachedFileBank, meta: cachedMeta };
  const raw = await fs.readFile(config.questionJsonPath, "utf-8");
  const parsed = JSON.parse(raw);
  cachedFileBank = parsed.questions || [];
  cachedMeta = parsed.meta || {};
  return { questions: cachedFileBank, meta: cachedMeta };
}

export function resetFileCache() {
  cachedFileBank = null;
  cachedMeta = null;
}

function normalizeQuery(query) {
  return {
    subject: query.subject || "",
    chapter: query.chapter || "",
    exam: query.exam || "",
    year: query.year ? Number(query.year) : "",
    difficulty: query.difficulty || "",
    repeated: query.repeated ? Number(query.repeated) : 0,
    highYield: query.highYield === "true" || query.highYield === true,
    imageOnly: query.imageOnly === "true" || query.imageOnly === true,
    search: String(query.search || "").trim(),
    ids: Array.isArray(query.ids) ? query.ids : []
  };
}

function fileMatches(question, filters) {
  if (filters.subject && question.subject !== filters.subject) return false;
  if (filters.chapter && question.chapter !== filters.chapter) return false;
  if (filters.exam && question.exam !== filters.exam) return false;
  if (filters.year && question.year !== filters.year) return false;
  if (filters.difficulty && question.difficulty !== filters.difficulty) return false;
  if (filters.repeated && (question.repeatedCount || 1) < filters.repeated) return false;
  if (filters.highYield && !question.highYield) return false;
  if (filters.imageOnly && !((question.images || []).length || (question.sourceMedia || []).length)) return false;
  if (filters.ids.length && !filters.ids.includes(question.id)) return false;
  if (filters.search) {
    const haystack = [
      question.question,
      ...(question.options || []),
      question.explanation,
      question.subject,
      question.chapter,
      question.subtopic,
      ...(question.concepts || []),
      ...(question.tags || [])
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}

function mongoFilter(filters) {
  const filter = {};
  if (filters.subject) filter.subject = filters.subject;
  if (filters.chapter) filter.chapter = filters.chapter;
  if (filters.exam) filter.exam = filters.exam;
  if (filters.year) filter.year = filters.year;
  if (filters.difficulty) filter.difficulty = filters.difficulty;
  if (filters.repeated) filter.repeatedCount = { $gte: filters.repeated };
  if (filters.highYield) filter.highYield = true;
  if (filters.imageOnly) filter.$or = [{ "images.0": { $exists: true } }, { "sourceMedia.0": { $exists: true } }];
  if (filters.ids.length) filter.id = { $in: filters.ids };
  if (filters.search) filter.$text = { $search: filters.search };
  return filter;
}

export async function getQuestionMeta() {
  if (getDatabaseMode() === "mongo") {
    const [subjects, exams, years, totalQuestions, gradableQuestions, imageQuestions] = await Promise.all([
      Question.distinct("subject"),
      Question.distinct("exam"),
      Question.distinct("year"),
      Question.countDocuments(),
      Question.countDocuments({ correct: { $type: "number" } }),
      Question.countDocuments({ $or: [{ "images.0": { $exists: true } }, { "sourceMedia.0": { $exists: true } }] })
    ]);

    const chapters = {};
    for (const subject of subjects.sort()) {
      chapters[subject] = (await Question.distinct("chapter", { subject })).sort();
    }

    return {
      title: "MedVault PYQ",
      totalQuestions,
      gradableQuestions,
      imageQuestions,
      subjects: subjects.sort(),
      exams: exams.sort(),
      years: years.sort((a, b) => a - b),
      chapters
    };
  }
  const { meta } = await loadFileBank();
  return meta;
}

export async function findQuestions(query = {}, options = {}) {
  const filters = normalizeQuery(query);
  const maxLimit = Number(options.maxLimit || 200);
  const limit = Math.min(Number(options.limit || query.limit || 50), maxLimit);
  const skip = Math.max(Number(options.skip || query.skip || 0), 0);

  if (getDatabaseMode() === "mongo") {
    const filter = mongoFilter(filters);
    const [items, total] = await Promise.all([
      Question.find(filter).sort({ subject: 1, year: -1, questionNo: 1 }).skip(skip).limit(limit).lean(),
      Question.countDocuments(filter)
    ]);
    return { items, total, limit, skip };
  }

  const { questions } = await loadFileBank();
  const filtered = questions.filter(question => fileMatches(question, filters));
  return { items: filtered.slice(skip, skip + limit), total: filtered.length, limit, skip };
}

export async function getQuestionById(id) {
  if (getDatabaseMode() === "mongo") {
    return Question.findOne({ id }).lean();
  }
  const { questions } = await loadFileBank();
  return questions.find(question => question.id === id) || null;
}

export async function sampleQuestions(query = {}, count = 20) {
  const max = Math.min(Math.max(Number(count || 20), 1), 30);
  const { items, total } = await findQuestions(query, { limit: 200 });
  const pool = items.length < total ? (await findQuestions(query, { limit: Math.min(total, 5000), maxLimit: 5000 })).items : items;
  return pool
    .map(item => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, max)
    .map(({ item }) => item);
}
