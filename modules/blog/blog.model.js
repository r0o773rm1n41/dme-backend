// modules/blog/blog.model.js
import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    title: {
      type: String,
      required: true,
      maxlength: 150, // 30 words approx
      trim: true,
      validate: {
        validator: function(v) {
          // Count words (split by whitespace and filter empty strings)
          const words = v.trim().split(/\s+/).filter(word => word.length > 0);
          return words.length <= 30;
        },
        message: 'Title cannot exceed 30 words'
      }
    },

    content: {
      type: String,
      required: true,
      maxlength: 1500, // 300 words approx
      validate: {
        validator: function(v) {
          // Count words (split by whitespace and filter empty strings)
          const words = v.trim().split(/\s+/).filter(word => word.length > 0);
          return words.length <= 300;
        },
        message: 'Content cannot exceed 300 words'
      }
    },

    pdfUrl: {
      type: String // Cloudinary public_id for signed URL generation
    },

    pdfSize: {
      type: Number, // Size in bytes
      validate: {
        validator: function(v) {
          return !v || v <= 10 * 1024 * 1024; // 10MB max
        },
        message: 'PDF size cannot exceed 10MB'
      }
    },

    visibility: {
      type: String,
      enum: ["PUBLIC", "PAID_ONLY"],
      default: "PUBLIC",
      index: true
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "DELETED"],
      default: "PENDING",
      index: true
    },

    likes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],

    likesCount: {
      type: Number,
      default: 0
    },

    viewsCount: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Performance indexes
blogSchema.index({ status: 1, visibility: 1, createdAt: -1 }); // For approved public blogs sorted by date
blogSchema.index({ author: 1, status: 1, createdAt: -1 }); // For user's blogs
blogSchema.index({ likesCount: -1, createdAt: -1 }); // For popular blogs
blogSchema.index({ createdAt: -1 }); // For latest blogs

export default mongoose.model("Blog", blogSchema);
