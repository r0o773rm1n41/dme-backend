// modules/user/user.model.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["USER", "QUIZ_ADMIN", "CONTENT_ADMIN", "SUPER_ADMIN"],
      default: "USER",
      index: true
    },

    name: {
      type: String,
      trim: true,
      maxlength: 50
    },

    phone: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },

    passwordHash: {
      type: String,
      required: true
    },

    phoneVerified: {
      type: Boolean,
      default: false
    },

    isPhoneVerified: {
      type: Boolean,
      default: false
    },

    emailVerified: {
      type: Boolean,
      default: false
    },

    otpMode: {
      type: String,
      enum: ["SMS", "EMAIL"],
      required: false, // Set during first OTP verification, then immutable
      index: true,
      immutable: true
    },

    profileImage: {
      type: String // Cloudinary URL
    },

    fcmToken: {
      type: String, // Firebase Cloud Messaging token for push notifications
      sparse: true,
      index: true
    },

    isBlocked: {
      type: Boolean,
      default: false
    },

    profileCompleted: {
      type: Boolean,
      default: false
    },

    // Gamification features
    currentStreak: {
      type: Number,
      default: 0,
      min: 0
    },

    longestStreak: {
      type: Number,
      default: 0,
      min: 0
    },

    lastQuizParticipation: {
      type: Date,
      index: true
    },

    // Referral system
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },

    referralCount: {
      type: Number,
      default: 0,
      min: 0
    },

    successfulReferrals: {
      type: Number,
      default: 0,
      min: 0
    },

    referralRewardCount: {
      type: Number,
      default: 0,
      min: 0
    },

    // Referral & rewards stats
    referralStats: {
      totalReferrals: {
        type: Number,
        default: 0,
        min: 0
      },
      totalRewardsEarned: {
        type: Number,
        default: 0,
        min: 0
      }
    },

    // Lifetime PDF access flag
    hasPdfAccess: {
      type: Boolean,
      default: false
    },

    // Temporary PDF credits granted via referrals
    temporaryPdfCredits: {
      uploads: {
        type: Number,
        default: 0,
        min: 0
      },
      downloads: {
        type: Number,
        default: 0,
        min: 0
      }
    },

    // Free quiz credits earned via referrals or rewards
    freeQuizCredits: {
      type: Number,
      default: 0,
      min: 0
    },

    // Tracks if user has made their first payment (used for referral completion)
    hasPaidBefore: {
      type: Boolean,
      default: false
    },

    // Device tracking for anti-fraud
    deviceId: {
      type: String,
      sparse: true,
      index: true
    },

    lastLoginIp: {
      type: String
    },

    // Subscription system
    subscriptionTier: {
      type: String,
      enum: ['FREE', 'BASIC', 'PREMIUM'],
      default: 'FREE'
    },

    subscriptionExpiresAt: Date,

    lastLoginAt: Date,

    // Profile fields
    fullName: {
      type: String,
      trim: true,
      maxlength: 50
    },

    username: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      maxlength: 30,
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
    },

    age: {
      type: Number,
      min: 13,
      max: 99
    },

    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other']
    },

    schoolName: {
      type: String,
      trim: true,
      maxlength: 100
    },

    class: {
      type: String,
      enum: ['10', '12', 'Other', null],
      index: true
    },

    // User preferences
    preferences: {
      type: Object,
      default: {}
    },

    // Quiz eligibility tracking per quiz date
    quizEligibility: {
      eligibleDate: Date,
      isEligible: Boolean
    }
  },
  { timestamps: true }
);

// Virtual for displayName (fallback to name or fullName)
userSchema.virtual('displayName').get(function() {
  return this.fullName || this.name || this.username || this.phone || this.email || `user_${this._id}`;
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// Normalize subscriptionTier to uppercase and map common lowercase values
userSchema.pre('validate', function(next) {
  if (this.subscriptionTier && typeof this.subscriptionTier === 'string') {
    const val = this.subscriptionTier.trim();
    if (val.length > 0 && val.toUpperCase() !== val) {
      this.subscriptionTier = val.toUpperCase();
    }
  }
  next();
});

export default mongoose.model("User", userSchema);
