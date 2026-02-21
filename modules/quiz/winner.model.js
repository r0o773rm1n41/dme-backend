// modules/quiz/winner.model.js
import mongoose from "mongoose";

const winnerSchema = new mongoose.Schema(
  {
    quizDate: {
      type: String,
      index: true
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },

    rank: {
      type: Number,
      required: true
    },

    score: {
      type: Number,
      required: true
    },

    accuracy: {
      type: Number, // percentage
      required: true
    },

    totalTimeMs: {
      type: Number,
      required: true
    },

    // Forensic snapshots for dispute resolution
    quizSnapshot: {
      version: String, // Quiz version/hash for integrity
      questionCount: Number,
      questionHashes: [String], // Hashes of all questions for dispute proof
      createdAt: Date
    },

    attemptSnapshot: {
      answersHash: String, // Hash of user's answers for integrity proof
      questionOrder: [Number], // Order in which questions were presented
      answerTimestamps: [Date], // When each answer was submitted
      finalizedAt: Date,
      eligibilityReason: String, // Why this attempt was eligible
      paymentId: mongoose.Schema.Types.ObjectId, // Reference to payment for verification
      totalTimeMs: Number,
      score: Number
    },

    snapshotAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate winners
winnerSchema.index({ quizDate: 1, user: 1 }, { unique: true });
winnerSchema.index({ quizDate: 1, rank: 1 }, { unique: true });

// D1: Index for leaderboard queries (quizDate + score)
winnerSchema.index({ quizDate: 1, score: -1 });

export default mongoose.model("Winner", winnerSchema);
