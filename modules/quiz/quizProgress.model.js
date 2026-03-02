// modules/quiz/quizProgress.model.js
import mongoose from "mongoose";

const questionProgressSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true
    },
    sentAt: {
      type: Date,
      required: true
    },
    answeredAt: {
      type: Date
    },
    isCorrect: {
      type: Boolean
    }
  },
  { _id: false }
);

const quizProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    quizDate: {
      type: String,
      required: true,
      index: true
    },
    questions: {
      type: [questionProgressSchema],
      default: []
    },
    lastActivity: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Compound unique index
quizProgressSchema.index({ user: 1, quizDate: 1 }, { unique: true });

// TTL index to auto-cleanup old progress (24 hours)
quizProgressSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.model("QuizProgress", quizProgressSchema);