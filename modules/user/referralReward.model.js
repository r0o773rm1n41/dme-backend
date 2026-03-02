// modules/user/referralReward.model.js
import mongoose from 'mongoose';

const referralRewardSchema = new mongoose.Schema({
  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  referee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  quizDate: {
    type: String,
    required: true,
    index: true
  },

  rewardType: {
    type: String,
    enum: ['BONUS_ENTRY', 'STREAK_BONUS', 'CASH_REWARD', 'REGISTRATION_BONUS', 'QUIZ_BONUS'],
    required: true
  },

  rewardAmount: {
    type: Number,
    required: true,
    min: 0
  },

  status: {
    type: String,
    enum: ['PENDING', 'AWARDED', 'CLAIMED'],
    default: 'PENDING'
  },

  awardedAt: Date,

  claimedAt: Date
}, { timestamps: true });

// Compound index for uniqueness
referralRewardSchema.index({ referrer: 1, referee: 1, quizDate: 1 }, { unique: true });

export default mongoose.model('ReferralReward', referralRewardSchema);