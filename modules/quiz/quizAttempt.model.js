// quizAttempt.model.js
import mongoose from "mongoose";

const quizAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },

    quizDate: {
      type: String,
      index: true
    },

    answers: {
      type: [Number], // selected option index per question
      default: []
    },

    answerTimestamps: {
      type: [Date], // server timestamp when each answer was submitted
      default: []
    },

    questionStartTimes: {
      type: [Date], // server timestamp when each question was sent to client
      default: []
    },

    questionHashes: {
      type: [String], // hash of question content to prevent tampering
      default: []
    },

    questionOrder: {
      type: [Number], // shuffled order of questions (indices into quiz.questions array)
      default: []
    },

    optionOrders: {
      type: [[Number]], // shuffled order of options for each question [[0,1,2,3], [2,0,1,3], ...]
      default: []
    },

    score: {
      type: Number,
      default: 0
    },

    totalTimeMs: {
      type: Number,
      default: 0
    },

    counted: {
      type: Boolean,
      default: true
    },

    answersSaved: {
      type: Boolean,
      default: false
    },

    isEligible: {
      type: Boolean,
      default: false,
      index: true
    },

    eligibilityReason: {
      type: String,
      enum: [
        "PAYMENT_SUCCESS",
        "PAYMENT_MISSING",
        "PAYMENT_REQUIRED",
        "QUIZ_NOT_LIVE",
        "LATE_SUBMISSION",
        "ELIGIBLE",
        "PROFILE_INCOMPLETE"
      ],
      index: true
    },

    eligibilitySnapshotAt: {
      type: Date,
      index: true
    },

    currentQuestionIndex: {
      type: Number,
      default: 0,
      min: 0,
      max: 50
    },

    deviceId: {
      type: String,
      index: true
    },

    deviceFingerprint: {
      type: String, // Hash of device characteristics
      index: true
    },

    ipAddress: {
      type: String,
      index: true
    },

    completedAt: {
      type: Date
    },

    // A2: Quiz time window enforcement
    quizStartedAt: {
      type: Date,
      index: true
    },

    // A4: Device locking for multi-device prevention
    lockedDeviceHash: {
      type: String, // Hash of deviceId + deviceFingerprint + ipAddress
      index: true
    },

    // B2: Eligibility snapshot at quiz start
    eligibilitySnapshot: {
      eligible: Boolean,
      reason: String,
      paymentId: mongoose.Schema.Types.ObjectId,
      snapshotAt: Date
    },

    // B3: Finalization protection
    finalizedAt: {
      type: Date,
      index: true
    },

    questionTimeLimits: {
      type: [Number],
      default: []
    },

    questionIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: []
    }
  },
  { timestamps: true }
);

const IMMUTABLE_FIELDS = ['quizStartedAt', 'lockedDeviceHash', 'eligibilitySnapshot'];
quizAttemptSchema.pre('save', function(next) {
  if (!this.isNew) {
    for (const f of IMMUTABLE_FIELDS) {
      if (this.isModified(f)) return next(new Error(`Cannot modify immutable field: ${f}`));
    }
  }
  next();
});

quizAttemptSchema.index({ user: 1, quizDate: 1 }, { unique: true });

quizAttemptSchema.index({ quizDate: 1, score: -1, totalTimeMs: 1, completedAt: 1, _id: 1 });

// Additional performance indexes
quizAttemptSchema.index({ quizDate: 1, isEligible: 1, counted: 1, score: -1 }); // For eligible leaderboard
quizAttemptSchema.index({ user: 1, quizDate: -1 }); // For user quiz history
quizAttemptSchema.index({ createdAt: -1 }); // For recent attempts
quizAttemptSchema.index({ finalizedAt: 1 }); // For finalization queries (D1)
quizAttemptSchema.index({ quizDate: 1, finalizedAt: 1 }); // For finalized attempts query

export default mongoose.model("QuizAttempt", quizAttemptSchema);
