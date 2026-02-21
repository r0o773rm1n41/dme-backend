// modules/reports/report.model.js
import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  blog: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Blog',
    required: true
  },
  reason: {
    type: String,
    required: true,
    enum: ['spam', 'harassment', 'inappropriate', 'copyright', 'other']
  },
  description: {
    type: String,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Index for efficient queries
reportSchema.index({ reportedUser: 1, status: 1 });
reportSchema.index({ reporter: 1 });

const Report = mongoose.model('Report', reportSchema);
export default Report;