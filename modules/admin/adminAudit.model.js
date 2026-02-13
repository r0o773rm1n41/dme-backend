// modules/admin/adminAudit.model.js
import mongoose from "mongoose";
import crypto from "crypto";

const adminAuditSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Allow null for system actions
      index: true
    },

    action: {
      type: String,
      required: true,
      enum: [
        "QUIZ_CREATED",
        "QUIZ_CREATED_CSV",
        "QUIZ_UPDATED",
        "QUIZ_LOCKED",
        "QUIZ_STARTED",
        "QUIZ_ENDED",
        "QUIZ_FINALIZED",
        "WINNERS_CALCULATED",
        "BLOG_APPROVED",
        "BLOG_REJECTED",
        "USER_SUSPENDED",
        "USER_ACTIVATED",
        "USER_BLOCKED",
        "USER_UNBLOCKED",
        "USER_DELETED",
        "REFUND_PROCESS_REQUESTED",
        "REFUND_STATUS_UPDATED",
        "QUIZ_STATE_CHANGE",
        "FORCE_FINALIZE",
        "DISASTER_RECOVERY",
        "ADMIN_LOGIN",
        "SYSTEM_MAINTENANCE"
      ]
    },

    targetType: {
      type: String,
      required: true,
      enum: ["QUIZ", "BLOG", "USER", "REFUND", "SYSTEM"]
    },

    targetId: {
      type: String,
      required: true
    },

    details: {
      type: mongoose.Schema.Types.Mixed
    },

    beforeSnapshot: { type: mongoose.Schema.Types.Mixed },
    afterSnapshot: { type: mongoose.Schema.Types.Mixed },

    ipAddress: {
      type: String
    },

    userAgent: {
      type: String
    },

    // For audit integrity
    checksum: {
      type: String,
      index: true
    }
  },
  { timestamps: true }
);

// Indexes for efficient querying
adminAuditSchema.index({ admin: 1, createdAt: -1 });
adminAuditSchema.index({ action: 1, createdAt: -1 });
adminAuditSchema.index({ targetType: 1, targetId: 1 });

// Pre-save hook to generate checksum for audit integrity
adminAuditSchema.pre('save', function(next) {
  const data = JSON.stringify({
    admin: this.admin,
    action: this.action,
    targetType: this.targetType,
    targetId: this.targetId,
    details: this.details,
    createdAt: this.createdAt
  });
  this.checksum = crypto.createHash('sha256').update(data).digest('hex');
  next();
});

export default mongoose.model("AdminAudit", adminAuditSchema);