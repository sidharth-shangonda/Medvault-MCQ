import mongoose from "mongoose";

const UserQuestionStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    questionId: { type: String, required: true, index: true },
    attempts: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    totalTimeMs: { type: Number, default: 0 },
    bookmarked: { type: Boolean, default: false, index: true },
    dueAt: { type: Date },
    intervalIndex: { type: Number, default: 0 },
    lastConfidence: { type: String, default: "" },
    lastSelected: { type: Number },
    lastCorrect: { type: Boolean }
  },
  { timestamps: true }
);

UserQuestionStateSchema.index({ userId: 1, questionId: 1 }, { unique: true });
UserQuestionStateSchema.index({ userId: 1, dueAt: 1 });

export const UserQuestionState = mongoose.model("UserQuestionState", UserQuestionStateSchema);
