import mongoose from 'mongoose';

const refundSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  razorpayPaymentId: String,
  razorpayRefundId: String,
  amount: Number, // in rupees
  reason: String,
  status: { type: String, enum: ['REQUESTED','PROCESSING','COMPLETED','FAILED'], default: 'REQUESTED', index: true },
  metadata: Object
}, { timestamps: true });

export default mongoose.model('Refund', refundSchema);
