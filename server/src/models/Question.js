import mongoose from "mongoose";

const ImageRefSchema = new mongoose.Schema(
  {
    src: { type: String, required: true },
    page: { type: String, required: true }
  },
  { _id: false }
);

const ImageAuditSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "verified", "needs_fix", "not_image_based"],
      default: "pending"
    },
    note: { type: String, default: "" },
    verifiedImages: { type: [ImageRefSchema], default: [] },
    updatedAt: { type: Date }
  },
  { _id: false }
);

const QuestionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: "" },
    subject: { type: String, required: true, index: true },
    chapter: { type: String, required: true, index: true },
    subtopic: { type: String, default: "", index: true },
    exam: { type: String, required: true, index: true },
    year: { type: Number, required: true, index: true },
    paper: { type: String, required: true, index: true },
    questionNo: { type: Number, required: true },
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correct: { type: Number, required: true },
    answerConfidence: { type: String, default: "" },
    explanation: { type: String, default: "" },
    difficulty: { type: String, default: "Moderate", index: true },
    repeatedCount: { type: Number, default: 1, index: true },
    highYield: { type: Boolean, default: false, index: true },
    concepts: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    sourcePages: { type: [Number], default: [] },
    explanationPages: { type: [Number], default: [] },
    images: { type: [ImageRefSchema], default: [] },
    sourceMedia: { type: [ImageRefSchema], default: [] },
    imageAudit: { type: ImageAuditSchema, default: () => ({}) }
  },
  { timestamps: true }
);

QuestionSchema.index({ subject: 1, chapter: 1, exam: 1, year: 1 });
QuestionSchema.index({ question: "text", explanation: "text", concepts: "text", tags: "text" });

export const Question = mongoose.model("Question", QuestionSchema);
