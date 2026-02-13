// modules/reports/block.model.js
import mongoose from 'mongoose';

const blockSchema = new mongoose.Schema({
  blocker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  blocked: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate blocks and for efficient queries
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });

const Block = mongoose.model('Block', blockSchema);
export default Block;