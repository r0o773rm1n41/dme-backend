// modules/payment/payment.model.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },

    quizDate: {
      type: String,
      index: true
    },

    amount: {
      type: Number,
      required: true
    },

    razorpayOrderId: String,
    razorpayPaymentId: String,

    status: {
      type: String,
      enum: ["CREATED", "SUCCESS", "FAILED", "LATE", "REFUNDED"],
      default: "CREATED",
      index: true
    }
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, quizDate: 1 }, { unique: true });

// Unique index for replay protection (OrderId + PaymentId should be unique)
paymentSchema.index({ razorpayOrderId: 1, razorpayPaymentId: 1 }, { unique: true, sparse: true });

// D1: Index for eligibility queries (quizDate + status)
paymentSchema.index({ quizDate: 1, status: 1 });

export default mongoose.model("Payment", paymentSchema);
