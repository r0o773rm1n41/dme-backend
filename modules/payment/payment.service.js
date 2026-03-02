import { sendPaymentSuccessNotification } from "../notification/notification.service.js";
import Payment from "./payment.model.js";
import { createRazorpayOrder, verifyWebhookSignature } from "./razorpay.service.js";
import redisClient from "../../config/redis.js";
import User from "../user/user.model.js";

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

/**
 * Grant a free quiz entry for a given quizDate if the user has freeQuizCredits.
 * This creates a synthetic successful Payment record so that existing
 * eligibility logic and winner calculation work unchanged.
 */
export async function grantFreeQuizEntryIfAvailable(userId, quizDate) {
  // If already has a successful payment for this quizDate, do nothing
  const existing = await Payment.findOne({
    user: userId,
    quizDate,
    status: "SUCCESS"
  });
  if (existing) {
    return existing;
  }

  const user = await User.findById(userId);
  if (!user || !user.freeQuizCredits || user.freeQuizCredits <= 0) {
    return null;
  }

  // Consume one free quiz credit
  user.freeQuizCredits -= 1;
  await user.save();

  // Create a synthetic successful payment that looks like a quiz entry
  const payment = await Payment.create({
    user: userId,
    quizDate,
    amount: 0,
    status: "SUCCESS",
    paymentType: "FREE_CREDIT",
    razorpayOrderId: `FREE_${quizDate}_${userId}`,
    razorpayPaymentId: `FREE_${Date.now()}`
  });

  // Mark user as eligible for this quizDate (same structure as Razorpay webhook)
  user.quizEligibility = {
    eligibleDate: quizDate,
    isEligible: true
  };
  await user.save();

  // Clear eligibility cache so subsequent checks see the new payment
  try {
    const cacheKey = `eligibility:${userId}:${quizDate}`;
    await redisClient.del(cacheKey);
  } catch {
    // cache failures should not break quiz flow
  }

  return payment;
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

/* --------- REFERRAL COMPLETION ON FIRST PAYMENT --------- */

export async function completeReferral(user) {
  // Called when a referred user makes their first successful payment
  // This completes the referral chain and rewards the referrer

  if (!user.referredBy) {
    // User was not referred, nothing to do
    return;
  }

  try {
    const { default: Referral } = await import("../user/referral.model.js");

    // fetch referrer first so we can evaluate fraud
    const referrer = await User.findById(user.referredBy);
    if (!referrer) {
      console.warn(`Referrer ${user.referredBy} not found for referral completion`);
      return;
    }

    // Determine anti‑fraud flags
    let deviceMatch = false;
    let ipMatch = false;
    if (user.deviceId && referrer.deviceId && user.deviceId === referrer.deviceId) {
      deviceMatch = true;
      console.warn(`[FRAUD_FLAG] Device ID match detected for referral: referrer ${referrer._id}, referred ${user._id}`);
    }
    if (user.lastLoginIp && referrer.lastLoginIp && user.lastLoginIp === referrer.lastLoginIp) {
      ipMatch = true;
      console.warn(`[FRAUD_FLAG] IP match detected for referral: referrer ${referrer._id}, referred ${user._id}`);
    }

    // Atomically transition the referral record from PENDING to either COMPLETED or REVIEW
    const newStatus = deviceMatch || ipMatch ? "REVIEW" : "COMPLETED";
    const updated = await Referral.findOneAndUpdate(
      { referredUser: user._id, status: "PENDING" },
      {
        status: newStatus,
        completedAt: new Date(),
        ...(deviceMatch && { deviceIdMatch: true }),
        ...(ipMatch && { ipMatch: true })
      },
      { new: true }
    );

    if (!updated) {
      // either no pending referral exists or it was already processed
      return;
    }

    if (newStatus === "REVIEW") {
      // do not reward automatically; admin must approve later
      return;
    }

    // Increment successful referrals count
    referrer.successfulReferrals = (referrer.successfulReferrals || 0) + 1;

    // Every 3 successful referrals = +1 free quiz credit
    if (referrer.successfulReferrals % 3 === 0) {
      referrer.freeQuizCredits = (referrer.freeQuizCredits || 0) + 1;
      referrer.referralRewardCount = (referrer.referralRewardCount || 0) + 1;
      // also increment reward stats
      if (!referrer.referralStats) referrer.referralStats = {};
      referrer.referralStats.totalRewardsEarned = (referrer.referralStats.totalRewardsEarned || 0) + 1;
      console.log(`[REFERRAL] Referrer ${referrer._id} earned free quiz credit after ${referrer.successfulReferrals} referrals`);
    }

    await referrer.save();
    console.log(`[REFERRAL] Completed for user ${user._id}, referrer ${referrer._id}`);
  } catch (err) {
    console.error("Error completing referral:", err);
    // Don't break payment confirmation if referral completion fails
  }
}

export async function createOrder(userId, { parentalConsent } = {}) {
  const quizDate = todayIST();
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  // age enforcement
  if (user.age && user.age < 13) {
    throw new Error('Users must be at least 13 years old to participate');
  }
  if (user.age && user.age < 18 && !parentalConsent) {
    throw new Error('Parental consent is required for users under 18');
  }

  // Before allowing any kind of entry (credit or paid), enforce cutoff and quiz state
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const cutoff = new Date(istNow);
  cutoff.setHours(19, 55, 0, 0);

  if (istNow >= cutoff) {
    throw new Error("Payment cutoff time has passed. Quiz entries are no longer accepted.");
  }

  // Quiz must exist and still be accepting entries (LOCKED state only)
  const Quiz = (await import('../quiz/quiz.model.js')).default;
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz || quiz.state !== 'LOCKED') {
    throw new Error('Entries are not being accepted at this time');
  }

  // Check if user has free quiz credits available
  if (user.freeQuizCredits && user.freeQuizCredits > 0) {
    // Use free credit instead of requiring payment
    user.freeQuizCredits -= 1;
    await user.save();

    // Create a synthetic successful payment for eligibility logic
    const payment = await Payment.create({
      user: userId,
      quizDate,
      amount: 0,
      status: "SUCCESS",
      paymentType: "FREE_CREDIT",
      razorpayOrderId: `FREE_${quizDate}_${userId}`,
      razorpayPaymentId: `FREE_${Date.now()}`
    });

    // Mark user as eligible
    user.quizEligibility = {
      eligibleDate: quizDate,
      isEligible: true
    };
    await user.save();

    return { free: true, message: "Free quiz entry granted", payment };
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

  return { order };}

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
    // explicitly ensure quiz entry type
    payment.paymentType = payment.paymentType || "QUIZ_ENTRY";
    await payment.save();

    // Mark user as eligible for this quiz and unlock PDFs permanently
    const User = (await import("../user/user.model.js")).default;
    const user = await User.findById(payment.user);
    if (user) {
      user.quizEligibility = {
        eligibleDate: payment.quizDate,
        isEligible: true
      };
      if (payment.paymentType === "QUIZ_ENTRY") {
        user.hasPdfAccess = true;
      }
      
      // Mark as paid (trigger referral completion if this is first payment)
      const wasFirstPayment = !user.hasPaidBefore;
      user.hasPaidBefore = true;
      
      // Persist user changes
      await user.save();

      // Complete referral if this was the user's first payment
      if (wasFirstPayment && user.referredBy) {
        await completeReferral(user);
      }
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
