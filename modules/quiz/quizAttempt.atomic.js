/**
 * Atomic quiz attempt creation - race-condition free
 * Uses findOneAndUpdate with $setOnInsert for idempotent upsert.
 * Device lock is set at attempt creation (no first-answer race).
 */
import mongoose from 'mongoose';
import crypto from 'crypto';
import QuizAttempt from './quizAttempt.model.js';
import Quiz from './quiz.model.js';
import { isQuizLive } from './quiz.lifecycle.js';
import { getCurrentQuestionIndex } from './quiz.service.js';
import ObservabilityService from '../monitoring/observability.service.js';

// Fisher-Yates shuffle for deterministic per-user question order
function shuffleArray(array, seed) {
  const shuffled = [...array];
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Idempotent quiz attempt creation - safe for duplicate joins.
 * Returns existing attempt if already created (treat "already exists" as success).
 */
export async function createQuizAttemptAtomic(userId, quizDate, deviceInfo = {}) {
  if (!(await isQuizLive(quizDate))) {
    throw new Error('Quiz is not live');
  }

  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) throw new Error('Quiz not found for today');

  // Before checking eligibility, try to consume a free quiz credit if available.
  // This will create a synthetic successful payment when a credit exists so that
  // the rest of the eligibility pipeline remains unchanged.
  const { grantFreeQuizEntryIfAvailable, getEffectiveEligibility } = await import('../payment/payment.service.js');
  await grantFreeQuizEntryIfAvailable(userId, quizDate);

  const eligibility = await getEffectiveEligibility(userId, quizDate);

  const payment = await mongoose.model('Payment').findOne({ user: userId, quizDate, status: 'SUCCESS' });
  const eligibilitySnapshot = {
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    paymentId: payment ? payment._id : null,
    snapshotAt: new Date()
  };

  const deviceHash = crypto.createHash('sha256')
    .update(`${deviceInfo.deviceId || ''}:${deviceInfo.deviceFingerprint || ''}:${deviceInfo.ipAddress || ''}`)
    .digest('hex');

  const userIdStr = userId.toString();
  const seed = userIdStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const shuffledIndices = shuffleArray(quiz.questions.map((_, i) => i), seed);
  const questionIds = shuffledIndices.map(idx => quiz.questions[idx]);

  const globalCurrentIndex = await getCurrentQuestionIndex(quizDate);
  const quizStartedAt = new Date();

  const insertDoc = {
    user: userId,
    quizDate,
    answers: [],
    score: 0,
    totalTimeMs: 0,
    isEligible: eligibility.eligible,
    counted: eligibility.eligible,
    answersSaved: false,
    questionOrder: shuffledIndices,
    questionIds,
    deviceId: deviceInfo.deviceId,
    deviceFingerprint: deviceInfo.deviceFingerprint,
    ipAddress: deviceInfo.ipAddress,
    lockedDeviceHash: deviceHash,
    eligibilitySnapshot,
    quizStartedAt,
    eligibilityReason: eligibility.reason,
    currentQuestionIndex: globalCurrentIndex
  };

  try {
    const result = await QuizAttempt.findOneAndUpdate(
      { user: userId, quizDate },
      { $setOnInsert: insertDoc },
      { upsert: true, new: true }
    );

    if (!result) {
      const existing = await QuizAttempt.findOne({ user: userId, quizDate });
      if (existing) return await handleExistingAttempt(existing, deviceInfo, userId, quizDate);
      throw new Error('Failed to create quiz attempt');
    }

    if (result.answersSaved) {
      throw new Error('You have already started this quiz. Please complete it or wait for the next quiz.');
    }
    return result;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await QuizAttempt.findOne({ user: userId, quizDate });
      if (existing) return await handleExistingAttempt(existing, deviceInfo, userId, quizDate);
    }
    throw err;
  }
}

async function handleExistingAttempt(existing, deviceInfo, userId, quizDate) {
  if (existing.answersSaved) {
    throw new Error('You have already started this quiz. Please complete it or wait for the next quiz.');
  }
  if (existing.lockedDeviceHash) {
    const currentDeviceHash = crypto.createHash('sha256')
      .update(`${deviceInfo.deviceId || ''}:${deviceInfo.deviceFingerprint || ''}:${deviceInfo.ipAddress || ''}`)
      .digest('hex');
    if (existing.lockedDeviceHash !== currentDeviceHash) {
      await ObservabilityService.recordAntiCheatEvent(userId, quizDate, 'device_mismatch_on_resume', {});
      throw new Error('Device mismatch - this quiz attempt is locked to a different device');
    }
  }
  return existing;
}
