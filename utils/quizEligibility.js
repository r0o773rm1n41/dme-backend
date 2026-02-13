// utils/quizEligibility.js

// Check if user profile is complete (required for quiz participation)
export function isProfileComplete(user) {
  if (!user) return false;
  
  // Required fields: name/fullName, username, age, classGrade, schoolName, gender
  const hasName = !!(user.fullName || user.name);
  const hasUsername = !!user.username;
  const hasAge = !!user.age && user.age >= 13 && user.age <= 99;
  const hasClass = !!user.classGrade && ['10th', '12th', 'Other'].includes(user.classGrade);
  const hasSchool = !!user.schoolName && user.schoolName.trim().length > 0;
  const hasGender = !!user.gender && ['Male', 'Female', 'Other'].includes(user.gender);
  
  return hasName && hasUsername && hasAge && hasClass && hasSchool && hasGender;
}

export function evaluateEligibility({ user, payment, quiz, now = new Date() }) {
  // Quiz must be live
  if (!quiz || quiz.state !== 'LIVE') {
    return { eligible: false, reason: 'QUIZ_NOT_LIVE' };
  }

  // User must exist
  if (!user) {
    return { eligible: false, reason: 'USER_NOT_FOUND' };
  }

  // Check if profile is complete (required before quiz participation)
  if (!isProfileComplete(user)) {
    return { eligible: false, reason: 'PROFILE_INCOMPLETE' };
  }

  // Payment must be successful for today's quiz
  if (!payment || payment.status !== 'SUCCESS' || payment.quizDate !== quiz.quizDate) {
    return { eligible: false, reason: 'PAYMENT_MISSING' };
  }

  // Check subscription tier requirements
  if (quiz.subscriptionRequired && quiz.subscriptionRequired !== 'FREE') {
    if (!user.subscriptionTier || user.subscriptionTier === 'FREE') {
      return { eligible: false, reason: 'SUBSCRIPTION_REQUIRED' };
    }

    const tierHierarchy = { 'FREE': 0, 'BASIC': 1, 'PREMIUM': 2 };
    const requiredTier = tierHierarchy[quiz.subscriptionRequired] || 0;
    const userTier = tierHierarchy[user.subscriptionTier] || 0;

    if (userTier < requiredTier) {
      return { eligible: false, reason: 'INSUFFICIENT_SUBSCRIPTION' };
    }

    // Check subscription expiration
    if (user.subscriptionExpiresAt && now > user.subscriptionExpiresAt) {
      return { eligible: false, reason: 'SUBSCRIPTION_EXPIRED' };
    }
  }

  // Check streak requirements for higher tiers
  if (quiz.minStreakRequired && quiz.minStreakRequired > 0) {
    if (!user.currentStreak || user.currentStreak < quiz.minStreakRequired) {
      return { eligible: false, reason: 'INSUFFICIENT_STREAK' };
    }
  }

  // Check if quiz is still active (not ended)
  if (quiz.endTime && now > quiz.endTime) {
    return { eligible: false, reason: 'QUIZ_ENDED' };
  }

  return { eligible: true, reason: 'ELIGIBLE' };
}

export function evaluateEligibilityForWinners({ user, payment, quiz, attempt, hasRefundAfterQuizStart = false }) {
  if (!user) return { eligible: false, reason: 'USER_NOT_FOUND' };
  if (!attempt || !attempt.answersSaved) return { eligible: false, reason: 'QUIZ_NOT_COMPLETED' };

  if (!payment || payment.status !== 'SUCCESS' || payment.quizDate !== quiz.quizDate) {
    return { eligible: false, reason: 'PAYMENT_MISSING' };
  }

  if (payment.status === 'REFUNDED' || hasRefundAfterQuizStart) {
    return { eligible: false, reason: 'REFUND_VOIDS_ELIGIBILITY' };
  }

  return { eligible: true, reason: 'COMPLETED_QUIZ' };
}

export function shouldCountAttempt(attempt) {
  return attempt.isEligible && attempt.counted && attempt.answersSaved;
}