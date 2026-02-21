import { sendPaymentSuccessNotification } from "../notification/notification.service.js";
import Payment from "./payment.model.js";
import { createRazorpayOrder, verifyWebhookSignature } from "./razorpay.service.js";
import redisClient from "../../config/redis.js";

function todayIST() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// B1: Single source of truth for eligibility - ALL routes must call this
export async function getEffectiveEligibility(userId, quizDate) {
  // D2: Redis must never be source of truth - only use for caching
  // Always check DB first, cache is just for performance
  
  const User = (await import("../user/user.model.js")).default;
  const Quiz = (await import("../quiz/quiz.model.js")).default;
  
  // Get user and payment from DB (source of truth)
  const [user, payment, quiz] = await Promise.all([
    User.findById(userId),
    Payment.findOne({ user: userId, quizDate, status: "SUCCESS" }),
    Quiz.findOne({ quizDate })
  ]);

  // Use centralized eligibility evaluation
  const { evaluateEligibility } = await import("../../utils/quizEligibility.js");
  const eligibility = evaluateEligibility({ user, payment, quiz });

  // Cache result for performance (but never use cache as source of truth)
  const cacheKey = `eligibility:${userId}:${quizDate}`;
  try {
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(eligibility));
  } catch (error) {
    console.warn('Redis cache write failed:', error.message);
  }

  return eligibility;
}

// Legacy function - now calls getEffectiveEligibility
export async function isUserEligible(userId, quizDate) {
  const eligibility = await getEffectiveEligibility(userId, quizDate);
  return eligibility.eligible;
}

// Check if user has ever made a successful payment (for PDF access)
export async function hasUserPaidEver(userId) {
  const cacheKey = `hasPaidEver:${userId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn('Redis cache read failed:', error.message);
  }

  const payment = await Payment.findOne({
    user: userId,
    status: "SUCCESS"
  });

  const hasPaid = Boolean(payment);

  // Cache for 1 hour
  try {
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(hasPaid));
  } catch (error) {
    console.warn('Redis cache write failed:', error.message);
  }

  return hasPaid;
}

// Get count of successful payments for today
export async function todayPaidCount() {
  const quizDate = todayIST();
  const cacheKey = `todayPaidCount:${quizDate}`;
  
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn('Redis cache read failed:', error.message);
  }

  const count = await Payment.countDocuments({
    quizDate,
    status: "SUCCESS"
  });

  // Cache for 5 minutes (frequently accessed)
  try {
    await redisClient.setEx(cacheKey, 300, JSON.stringify(count));
  } catch (error) {
    console.warn('Redis cache write failed:', error.message);
  }

  return count;
}

export async function createOrder(userId) {
  const quizDate = todayIST();

  // Check payment cutoff: 7:55 PM IST
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const cutoff = new Date(istNow);
  cutoff.setHours(19, 55, 0, 0); // 7:55 PM IST

  if (istNow >= cutoff) {
    throw new Error("Payment cutoff time has passed. Quiz payments are no longer accepted.");
  }

  const existing = await Payment.findOne({ user: userId, quizDate });
  if (existing) {
    if (existing.status === "SUCCESS") return { alreadyPaid: true };
    // If pending or failed, delete the old one and create new
    await Payment.deleteOne({ _id: existing._id });
  }

  const order = await createRazorpayOrder(
    500,
    "INR",
    `quiz_${quizDate}_${userId}`
  );

  await Payment.create({
    user: userId,
    quizDate,
    amount: 5,
    razorpayOrderId: order.id
  });

  return { order };
}

/* ---------------- VERIFY PAYMENT ---------------- */

export async function verifyPayment({ userId, orderId, paymentId, signature }) {
  const valid = verifyWebhookSignature({
    orderId,
    paymentId,
    signature
  });

  if (!valid) throw new Error("Invalid payment signature");

  const payment = await Payment.findOne({
    user: userId,
    razorpayOrderId: orderId
  });

  if (!payment) throw new Error("Payment record not found");

  // Idempotency: if already successful, return success
  if (payment.status === "SUCCESS") {
    return true;
  }

  // Prevent double verification
  if (payment.status !== "CREATED") {
    throw new Error("Payment already processed");
  }

  return true;
}

export async function verifyPaymentFrontend({ userId, orderId, paymentId, signature }) {
  // Frontend verification - cosmetic only, doesn't grant eligibility
  // Actual eligibility granted only via webhook
  const valid = verifyWebhookSignature({
    orderId,
    paymentId,
    signature
  });

  if (!valid) throw new Error("Invalid payment signature");

  // Just mark as verified, but don't grant eligibility yet
  const payment = await Payment.findOne({
    user: userId,
    razorpayOrderId: orderId
  });

  if (!payment) throw new Error("Payment record not found");

  if (payment.status === "SUCCESS") {
    return true; // Already processed
  }

  if (payment.status !== "CREATED") {
    throw new Error("Payment already processed");
  }

  // Mark as verified but not successful yet
  payment.status = "VERIFIED";
  payment.razorpayPaymentId = paymentId;
  payment.razorpaySignature = signature;
  await payment.save();

  return true;
}

export async function confirmPaymentWebhook({ orderId, paymentId, amount, status, createdAt }) {
  // Webhook-based payment confirmation - this is the ONLY way to grant eligibility
  const payment = await Payment.findOne({
    razorpayOrderId: orderId
  });

  if (!payment) {
    console.error(`Payment not found for order ${orderId}`);
    return;
  }

  if (payment.status === "SUCCESS") {
    console.log(`Payment ${orderId} already processed - ignoring duplicate webhook`);
    return;
  }

  // Validate payment time: if created_at > today 19:55 IST, mark as late and do not grant eligibility
  const paymentDate = new Date(createdAt * 1000); // Razorpay timestamp is in seconds
  const istPaymentDate = new Date(paymentDate.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const cutoff = new Date(today + 'T19:55:00');

  if (istPaymentDate > cutoff) {
    console.log(`Payment ${orderId} is late (${istPaymentDate.toISOString()}) - marking as LATE, no eligibility granted`);
    payment.status = "LATE";
    payment.razorpayPaymentId = paymentId;
    await payment.save();
    return;
  }

  if (status === "captured" && amount >= 500) { // ₹5 = 500 paisa
    payment.status = "SUCCESS";
    payment.razorpayPaymentId = paymentId;
    await payment.save();

    // Mark user as eligible for this quiz
    const User = (await import("../user/user.model.js")).default;
    const user = await User.findById(payment.user);
    if (user) {
      // Update quizEligibility
      user.quizEligibility = {
        eligibleDate: payment.quizDate,
        isEligible: true
      };
      await user.save();
    }

    // Clear eligibility cache
    try {
      const cacheKey = `eligibility:${payment.user}:${payment.quizDate}`;
      await redisClient.del(cacheKey);
    } catch (cacheError) {
      console.warn('Failed to clear cache:', cacheError.message);
    }

    // Send payment success notification
    try {
      await sendPaymentSuccessNotification(payment.user, payment.quizDate);
    } catch (notificationError) {
      console.error('Failed to send payment success notification:', notificationError);
      // Don't fail the payment confirmation if notification fails
    }

    console.log(`[PAYMENT] Confirmed for user ${payment.user} - eligibility granted for ${payment.quizDate}`);
  } else {
    console.error(`Payment failed or insufficient amount for order ${orderId}`);
  }
}

/* ---------------- ELIGIBILITY ---------------- */

export async function getUserPayments(userId) {
  const payments = await Payment.find({ user: userId })
    .sort({ createdAt: -1 }) // Most recent first
    .populate('user', 'fullName username phone email')
    .select('quizDate amount razorpayOrderId razorpayPaymentId status createdAt');

  return payments.map(payment => ({
    _id: payment._id,
    quizDate: payment.quizDate,
    amount: payment.amount / 100, // Convert from paisa to rupees
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    status: payment.status,
    createdAt: payment.createdAt,
    user: payment.user
  }));
}

/* ---------------- REFUNDS & DISPUTES (scaffolding) ---------------- */
import Refund from './refund.model.js';
import Razorpay from 'razorpay';

function getRazorpayInstance() {
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

export async function requestRefund(userId, paymentId, reason) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new Error('Payment not found');
  if (String(payment.user) !== String(userId)) throw new Error('Not authorized');

  // Create refund record
  const refund = await Refund.create({
    user: userId,
    payment: payment._id,
    razorpayPaymentId: payment.razorpayPaymentId,
    amount: payment.amount,
    reason,
    status: 'REQUESTED'
  });

  // Try to call Razorpay API to initiate refund if credentials are present
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && payment.razorpayPaymentId) {
    try {
      const razorpay = getRazorpayInstance();
      // amount in paise; refund full amount by default
      const refundResponse = await razorpay.payments.refund(payment.razorpayPaymentId, { notes: { reason } });
      refund.razorpayRefundId = refundResponse.id || refundResponse.entity?.id || null;
      refund.status = 'PROCESSING';
      refund.metadata = refundResponse;
      await refund.save();

      return { success: true, refundId: refund._id, processing: true };
    } catch (err) {
      console.error('Razorpay refund call failed:', err.message || err);
      refund.status = 'FAILED';
      await refund.save();
      return { success: false, message: 'Refund request recorded but remote refund failed' };
    }
  }

  return { success: true, refundId: refund._id, processing: false };
}

export async function handleDisputeWebhook(event) {
  // Placeholder: implement dispute handling when Razorpay sends dispute events
  // Should update Refund/payment status and notify admins
  console.log('Received dispute webhook (not implemented):', event);
}

/* ---------------- ADMIN REFUND HELPERS ---------------- */
export async function getAllRefunds() {
  return await Refund.find().populate('user', 'name phone email').populate('payment');
}

export async function adminProcessRefund(refundId, adminId) {
  const refund = await Refund.findById(refundId).populate('payment');
  if (!refund) throw new Error('Refund not found');

  if (refund.status === 'COMPLETED') return { success: true, message: 'Already completed' };
  if (refund.status === 'PROCESSING') return { success: true, message: 'Already processing' };

  // If Razorpay credentials present, attempt remote refund
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && refund.razorpayPaymentId) {
    try {
      const razorpay = getRazorpayInstance();
      const resp = await razorpay.payments.refund(refund.razorpayPaymentId, { notes: { admin: adminId, reason: refund.reason } });
      refund.razorpayRefundId = resp.id || resp.entity?.id || null;
      refund.status = 'PROCESSING';
      refund.metadata = resp;
      await refund.save();

      return { success: true, processing: true, refundId: refund._id };
    } catch (err) {
      console.error('Admin refund remote call failed:', err.message || err);
      refund.status = 'FAILED';
      refund.metadata = { error: err.message || String(err) };
      await refund.save();
      return { success: false, message: 'Remote refund failed' };
    }
  }

  // If no remote action possible, mark as REQUESTED and await manual processing
  refund.status = 'REQUESTED';
  await refund.save();
  return { success: true, processing: false, refundId: refund._id };
}
