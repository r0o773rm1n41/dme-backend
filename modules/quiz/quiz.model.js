// modules/quiz/quiz.model.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    question: String,
    options: [String],
    correctIndex: Number
  },
  { _id: false }
);

const quizSchema = new mongoose.Schema(
  {
    quizDate: {
      type: String, // YYYY-MM-DD (IST)
      unique: true,
      index: true
    },

    title: {
      type: String,
      default: 'Daily Quiz',
      trim: true
    },

    description: {
      type: String,
      default: 'Daily 50 Question Quiz',
      trim: true
    },

    state: {
      type: String,
      enum: ["DRAFT", "SCHEDULED", "LOCKED", "PAYMENT_CLOSED", "LIVE", "ENDED", "FINALIZED", "RESULT_PUBLISHED"],
      default: "DRAFT",
      index: true
    },

    questions: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Question' // Reference to Question model
    },

    eligibleUsers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: []
    },

    // Tiered quiz system
    tier: {
      type: String,
      enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'],
      default: 'BRONZE',
      index: true
    },

    // Tier requirements
    minStreakRequired: {
      type: Number,
      default: 0,
      min: 0
    },

    subscriptionRequired: {
      type: String,
      enum: ['FREE', 'BASIC', 'PREMIUM'],
      default: 'FREE'
    },

    // Class/Grade based quiz filtering
    classGrade: {
      type: String,
      enum: ['10th', '12th', 'Other', 'ALL'],
      default: 'ALL',
      index: true
    },

    lockedAt: Date,
    paymentClosedAt: Date,
    liveAt: Date,
    endedAt: Date,
    finalizedAt: Date,
    resultPublishedAt: Date
  },
  { timestamps: true }
);

// Virtual for isLive
quizSchema.virtual('isLive').get(function() {
  return this.state === 'LIVE';
});

// FSM transitions enforced in quiz.lifecycle.transitionQuiz
quizSchema.index({ state: 1, quizDate: -1 });
quizSchema.index({ quizDate: -1 });

export default mongoose.model("Quiz", quizSchema);
