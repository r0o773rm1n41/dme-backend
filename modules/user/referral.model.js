// modules/user/referral.model.js
import mongoose from "mongoose";

const referralSchema = new mongoose.Schema({
  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true, // Prevents duplicate referral assignment
    index: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'REJECTED', 'REVIEW'], // REVIEW used when fraud flagged and awaiting admin approval
    default: 'PENDING',
    index: true
  },
  completedAt: Date,
  rejectionReason: String,
  deviceIdMatch: Boolean, // Flag for fraud detection
  ipMatch: Boolean // Flag for fraud detection
}, {
  timestamps: true
});

// Index for finding referrals by referrer and status (useful for admin reporting)
referralSchema.index({ referrer: 1, status: 1 });

export default mongoose.model("Referral", referralSchema);
