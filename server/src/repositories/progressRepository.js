import { getDatabaseMode } from "../db.js";
import { Question } from "../models/Question.js";
import { QuizSession } from "../models/QuizSession.js";
import { UserQuestionState } from "../models/UserQuestionState.js";
import { findQuestions, getQuestionById } from "./questionRepository.js";

const REVIEW_INTERVALS = [1, 3, 7, 15, 30];
const memoryProgress = new Map();
const memorySessions = new Map();

function keyFor(userId, questionId) {
  return `${userId}::${questionId}`;
}

function getMemoryState(userId, questionId) {
  const key = keyFor(userId, questionId);
  if (!memoryProgress.has(key)) {
    memoryProgress.set(key, {
      userId,
      questionId,
      attempts: 0,
      correct: 0,
      wrong: 0,
      skipped: 0,
      totalTimeMs: 0,
      bookmarked: false,
      dueAt: null,
      intervalIndex: 0,
      lastConfidence: "",
      lastSelected: null,
      lastCorrect: null
    });
  }
  return memoryProgress.get(key);
}

export async function getQuestionState(userId, questionId) {
  if (getDatabaseMode() === "mongo") {
    return UserQuestionState.findOne({ userId, questionId }).lean();
  }
  return memoryProgress.get(keyFor(userId, questionId)) || null;
}

export async function toggleBookmark(userId, questionId) {
  if (getDatabaseMode() === "mongo") {
    const existing = await UserQuestionState.findOne({ userId, questionId });
    const next = !existing?.bookmarked;
    const state = await UserQuestionState.findOneAndUpdate(
      { userId, questionId },
      { $set: { bookmarked: next }, $setOnInsert: { attempts: 0 } },
      { upsert: true, new: true }
    ).lean();
    return state;
  }

  const state = getMemoryState(userId, questionId);
  state.bookmarked = !state.bookmarked;
  return state;
}

export async function submitSession({ userId, mode, filters = {}, answers = [] }) {
  const now = new Date();
  const rows = [];
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let totalTimeMs = 0;

  for (const answer of answers) {
    const question = await getQuestionById(answer.questionId);
    if (!question) continue;
    const isSkipped = answer.selected === null || answer.selected === undefined;
    const isCorrect = !isSkipped && Number(answer.selected) === Number(question.correct);
    const timeMs = Math.max(0, Number(answer.timeMs || 0));
    totalTimeMs += timeMs;
    if (isSkipped) skipped += 1;
    else if (isCorrect) correct += 1;
    else wrong += 1;

    const intervalIndex = isCorrect
      ? Math.min(REVIEW_INTERVALS.length - 1, Number(answer.intervalIndex || 0) + 1)
      : 0;
    const dueAt = isSkipped ? null : new Date(now.getTime() + REVIEW_INTERVALS[intervalIndex] * 86400000);

    const update = {
      $inc: {
        attempts: 1,
        correct: isCorrect ? 1 : 0,
        wrong: !isCorrect && !isSkipped ? 1 : 0,
        skipped: isSkipped ? 1 : 0,
        totalTimeMs: timeMs
      },
      $set: {
        dueAt,
        intervalIndex,
        lastConfidence: answer.confidence || "unsure",
        lastSelected: isSkipped ? null : Number(answer.selected),
        lastCorrect: isCorrect
      }
    };

    if (getDatabaseMode() === "mongo") {
      await UserQuestionState.findOneAndUpdate({ userId, questionId: question.id }, update, { upsert: true });
    } else {
      const state = getMemoryState(userId, question.id);
      state.attempts += 1;
      state.correct += isCorrect ? 1 : 0;
      state.wrong += !isCorrect && !isSkipped ? 1 : 0;
      state.skipped += isSkipped ? 1 : 0;
      state.totalTimeMs += timeMs;
      state.dueAt = dueAt;
      state.intervalIndex = intervalIndex;
      state.lastConfidence = answer.confidence || "unsure";
      state.lastSelected = isSkipped ? null : Number(answer.selected);
      state.lastCorrect = isCorrect;
    }

    rows.push({
      questionId: question.id,
      selected: isSkipped ? null : Number(answer.selected),
      correct: question.correct,
      isCorrect,
      skipped: isSkipped,
      confidence: answer.confidence || "unsure",
      timeMs
    });
  }

  const denominator = correct + wrong + skipped;
  const accuracy = denominator ? Math.round((correct / denominator) * 100) : 0;
  const session = {
    userId,
    mode,
    filters,
    questionIds: rows.map(row => row.questionId),
    answers: rows,
    correct,
    wrong,
    skipped,
    accuracy,
    totalTimeMs
  };

  if (getDatabaseMode() === "mongo") {
    return QuizSession.create(session);
  }

  const list = memorySessions.get(userId) || [];
  const saved = { ...session, _id: `${Date.now()}`, createdAt: new Date().toISOString() };
  list.unshift(saved);
  memorySessions.set(userId, list.slice(0, 50));
  return saved;
}

export async function getAnalytics(userId) {
  if (getDatabaseMode() === "mongo") {
    const states = await UserQuestionState.find({ userId }).lean();
    const sessions = await QuizSession.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
    const questions = await Question.find({}, { id: 1, subject: 1, chapter: 1 }).lean();
    return buildAnalytics(states, sessions, questions);
  }

  const states = [...memoryProgress.values()].filter(state => state.userId === userId);
  const sessions = memorySessions.get(userId) || [];
  const { items: questions } = await findQuestions({}, { limit: 10000, maxLimit: 10000 });
  return buildAnalytics(states, sessions, questions);
}

export async function getReviewQueue(userId, type = "mistakes", limit = 36) {
  const max = Math.min(Math.max(Number(limit || 36), 1), 100);
  const now = new Date();

  if (getDatabaseMode() === "mongo") {
    const filter = { userId };
    if (type === "bookmarked") filter.bookmarked = true;
    else if (type === "due") filter.dueAt = { $lte: now };
    else if (type === "guessed") filter.lastConfidence = "guessed";
    else filter.$or = [{ wrong: { $gt: 0 } }, { lastCorrect: false }];

    const states = await UserQuestionState.find(filter).sort({ updatedAt: -1 }).limit(max).lean();
    const questions = await Question.find({ id: { $in: states.map(state => state.questionId) } }).lean();
    const byId = new Map(questions.map(question => [question.id, question]));
    return {
      type,
      total: states.length,
      items: states
        .map(state => ({ state, question: byId.get(state.questionId) }))
        .filter(item => item.question)
    };
  }

  const states = [...memoryProgress.values()]
    .filter(state => state.userId === userId)
    .filter(state => {
      if (type === "bookmarked") return state.bookmarked;
      if (type === "due") return state.dueAt && new Date(state.dueAt) <= now;
      if (type === "guessed") return state.lastConfidence === "guessed";
      return state.wrong > 0 || state.lastCorrect === false;
    })
    .slice(0, max);
  const { items: questions } = await findQuestions({}, { limit: 10000, maxLimit: 10000 });
  const byId = new Map(questions.map(question => [question.id, question]));
  return {
    type,
    total: states.length,
    items: states
      .map(state => ({ state, question: byId.get(state.questionId) }))
      .filter(item => item.question)
  };
}

function buildAnalytics(states, sessions, questions) {
  const byId = new Map(questions.map(question => [question.id, question]));
  const stateByQuestion = new Map(states.map(state => [state.questionId, state]));
  const subjectMap = new Map();
  const chapterMap = new Map();
  const now = Date.now();
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let due = 0;
  let bookmarked = 0;

  for (const question of questions) {
    const state = stateByQuestion.get(question.id);
    addQuestionBucket(subjectMap, question.subject, state);
    addQuestionBucket(chapterMap, `${question.subject} / ${question.chapter}`, state);
  }

  for (const state of states) {
    correct += state.correct || 0;
    wrong += state.wrong || 0;
    skipped += state.skipped || 0;
    if (state.bookmarked) bookmarked += 1;
    if (state.dueAt && new Date(state.dueAt).getTime() <= now) due += 1;
  }

  const denominator = correct + wrong + skipped;
  const attempted = states.filter(state => state.attempts > 0).length;
  return {
    totals: {
      syllabusTotal: questions.length,
      attempted,
      completion: questions.length ? Math.round((attempted / questions.length) * 100) : 0,
      correct,
      wrong,
      skipped,
      accuracy: denominator ? Math.round((correct / denominator) * 100) : 0,
      due,
      bookmarked
    },
    subjects: [...subjectMap.values()].map(scoreBucket).sort((a, b) => a.completion - b.completion || a.name.localeCompare(b.name)),
    chapters: [...chapterMap.values()].map(scoreBucket).sort((a, b) => a.completion - b.completion || a.name.localeCompare(b.name)),
    sessions
  };
}

function addQuestionBucket(map, name, state) {
  if (!map.has(name)) map.set(name, { name, total: 0, attempted: 0, correct: 0, wrong: 0, skipped: 0, attempts: 0 });
  const item = map.get(name);
  item.total += 1;
  if (state?.attempts > 0) item.attempted += 1;
  item.correct += state?.correct || 0;
  item.wrong += state?.wrong || 0;
  item.skipped += state?.skipped || 0;
  item.attempts += state?.attempts || 0;
}

function scoreBucket(item) {
  const denominator = item.correct + item.wrong + item.skipped;
  return {
    ...item,
    accuracy: denominator ? Math.round((item.correct / denominator) * 100) : 0,
    completion: item.total ? Math.round((item.attempted / item.total) * 100) : 0
  };
}
