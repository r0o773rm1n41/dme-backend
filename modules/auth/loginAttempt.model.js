// modules/auth/loginAttempt.model.js
import mongoose from "mongoose";

const loginAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: false
    },
    phone: {
      type: String,
      index: true,
      required: true
    },
    ipAddress: {
      type: String,
      index: true
    },
    userAgent: String,
    success: {
      type: Boolean,
      default: false,
      index: true
    },
    reason: String
  },
  { timestamps: true }
);

// keep the most recent N logs per user/phone if needed via a TTL index or separate cleanup task
loginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // keep 30 days by default

export default mongoose.model("LoginAttempt", loginAttemptSchema);