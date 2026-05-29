import mongoose from "mongoose";

const SessionAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true },
    selected: { type: Number },
    correct: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    skipped: { type: Boolean, required: true },
    confidence: { type: String, default: "unsure" },
    timeMs: { type: Number, default: 0 }
  },
  { _id: false }
);

const QuizSessionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    mode: { type: String, required: true, index: true },
    filters: { type: Object, default: {} },
    questionIds: { type: [String], default: [] },
    answers: { type: [SessionAnswerSchema], default: [] },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    totalTimeMs: { type: Number, default: 0 }
  },
  { timestamps: true }
);

QuizSessionSchema.index({ userId: 1, createdAt: -1 });

export const QuizSession = mongoose.model("QuizSession", QuizSessionSchema);
