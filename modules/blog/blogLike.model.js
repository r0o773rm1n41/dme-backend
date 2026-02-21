// modules/blog/blogLike.model.js
import mongoose from "mongoose";

const blogLikeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    blog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Blog",
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate likes
blogLikeSchema.index({ user: 1, blog: 1 }, { unique: true });

// Index for counting likes per blog
blogLikeSchema.index({ blog: 1 });

// Index for user's likes
blogLikeSchema.index({ user: 1 });

export default mongoose.model("BlogLike", blogLikeSchema);