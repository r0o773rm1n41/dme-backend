// modules/payment/payment.controller.js
import * as PaymentService from "./payment.service.js";

export async function createOrder(req, res) {
  try {
    // parentalConsent is provided by frontend when user is under age limit
    const { parentalConsent } = req.body;
    const result = await PaymentService.createOrder(req.user._id, { parentalConsent });
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function verify(req, res) {
  try {
    // Frontend verification is now cosmetic only
    // Actual payment confirmation happens via webhook
    const result = await PaymentService.verifyPaymentFrontend({
      userId: req.user._id,
      orderId: req.body.razorpay_order_id,
      paymentId: req.body.razorpay_payment_id,
      signature: req.body.razorpay_signature
    });

    res.json({ success: true, message: "Payment verification initiated. Please wait for confirmation." });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function razorpayWebhook(req, res) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(500).json({ message: 'Webhook secret not configured' });
    }

    // Verify webhook signature
    const crypto = await import('crypto');
    const expectedSignature = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const razorpaySignature = req.headers['x-razorpay-signature'];
    if (expectedSignature !== razorpaySignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const redisClient = (await import('../../config/redis.js')).default;
    const eventId = req.body.event_id || req.headers['x-razorpay-event-id'];
    const paymentEntity = req.body.payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;
    const createdAt = paymentEntity?.created_at;

    if (eventId) {
      const processedKey = `webhook:idempotency:${eventId}`;
      try {
        const alreadyProcessed = await redisClient.get(processedKey);
        if (alreadyProcessed) {
          console.log(`Webhook ${eventId} already processed - idempotent response`);
          return res.status(200).json({ status: 'ok', idempotent: true });
        }
        await redisClient.setEx(processedKey, 86400 * 7, '1');
      } catch (redisError) {
        console.warn('Redis unavailable for idempotency:', redisError.message);
      }
    }

    const REPLAY_TOLERANCE_MS = 5 * 60 * 1000;
    if (createdAt && orderId) {
      const eventTime = new Date(createdAt * 1000).getTime();
      if (Math.abs(Date.now() - eventTime) > REPLAY_TOLERANCE_MS) {
        console.warn(`Webhook replay rejected: event too old order=${orderId}`);
        return res.status(400).json({ message: 'Event timestamp out of tolerance' });
      }
      const replayKey = `webhook:replay:${orderId}:${createdAt}`;
      try {
        const seen = await redisClient.get(replayKey);
        if (seen) {
          console.warn(`Webhook replay rejected: duplicate order=${orderId}`);
          return res.status(400).json({ message: 'Duplicate webhook rejected' });
        }
        await redisClient.setEx(replayKey, 86400, '1');
      } catch (e) {
        console.warn('Redis replay check failed:', e.message);
      }
    }

    const event = req.body.event;

    if (event === 'payment.captured' && paymentEntity) {
      await PaymentService.confirmPaymentWebhook({
        orderId: paymentEntity.order_id,
        paymentId: paymentEntity.id,
        amount: paymentEntity.amount,
        status: paymentEntity.status,
        createdAt: paymentEntity.created_at
      });
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
}

export async function quizStatus(req, res) {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const eligible = await PaymentService.isUserEligible(req.user._id, today);
    
    // Check if user has paid for today
    const Payment = (await import('./payment.model.js')).default;
    const payment = await Payment.findOne({
      user: req.user._id,
      quizDate: today,
      status: 'SUCCESS'
    });

    // Check if user has ever paid (for PDF access)
    const hasPaidEver = await PaymentService.hasUserPaidEver(req.user._id);

    // Check if there's a quiz available for user's class
    const QuizService = (await import('../quiz/quiz.service.js')).default || (await import('../quiz/quiz.service.js'));
    const quiz = await QuizService.getTodayQuiz(today, req.user._id);
    const quizAvailable = !!quiz;

    res.json({ 
      eligible,
      hasPaidToday: !!payment,
      hasPaidEver,
      quizAvailable,
      message: eligible 
        ? "You are eligible to participate in today's quiz" 
        : "Payment required to participate"
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

export async function paidCount(req, res) {
  try {
    const count = await PaymentService.todayPaidCount();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

export async function getUserPayments(req, res) {
  try {
    const payments = await PaymentService.getUserPayments(req.user._id);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

export async function requestRefund(req, res) {
  try {
    const { paymentId, reason } = req.body;
    if (!paymentId) return res.status(400).json({ message: 'paymentId required' });

    const result = await PaymentService.requestRefund(req.user._id, paymentId, reason);
    res.json(result);
  } catch (error) {
    console.error('Refund request error:', error);
    res.status(500).json({ message: error.message });
  }
}

export async function getUserEligibility(req, res) {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { isUserEligible } = await import('../payment/payment.service.js');
    const eligible = await isUserEligible(req.user._id, today);
    res.json({ eligible });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
