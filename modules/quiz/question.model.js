// modules/quiz/question.model.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true
    },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: function(arr) {
          return arr.length === 4;
        },
        message: 'Questions must have exactly 4 options'
      }
    },
    correctIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 3
    },
    points: {
      type: Number,
      default: 1,
      min: 1
    },
    // Optional metadata
    difficulty: {
      type: String,
      enum: ['EASY', 'MEDIUM', 'HARD'],
      default: 'MEDIUM'
    },
    subject: {
      type: String,
      trim: true
    },
    classGrade: {
      type: String,
      enum: ['10th', '12th', 'Other', 'ALL'],
      default: 'ALL'
    }
  },
  { timestamps: true }
);

// Index for performance
questionSchema.index({ classGrade: 1, difficulty: 1 });

export default mongoose.model("Question", questionSchema);