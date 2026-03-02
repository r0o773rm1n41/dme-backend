// modules/user/streak.service.js
import User from './user.model.js';
import QuizAttempt from '../quiz/quizAttempt.model.js';
import { sendStreakNotification } from '../notification/notification.service.js';

export async function updateUserStreak(userId, quizDate) {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    const quizDateObj = new Date(quizDate);
    const yesterday = new Date(quizDateObj);
    yesterday.setDate(yesterday.getDate() - 1);

    const today = new Date(quizDateObj);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(quizDateObj);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if user participated yesterday
    const yesterdayParticipation = await QuizAttempt.findOne({
      user: userId,
      quizDate: yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      answersSaved: true,
      counted: true
    });

    let newStreak = 1; // At least today's participation

    if (yesterdayParticipation) {
      // Continue streak
      newStreak = user.currentStreak + 1;
    } else if (user.lastQuizParticipation) {
      // Check if last participation was more than 1 day ago
      const lastParticipationDate = new Date(user.lastQuizParticipation);
      const daysDiff = Math.floor((quizDateObj - lastParticipationDate) / (1000 * 60 * 60 * 24));

      if (daysDiff > 1) {
        // Streak broken
        newStreak = 1;
      } else {
        // Same day or consecutive day
        newStreak = user.currentStreak + 1;
      }
    }

    // Update user streak
    const updateData = {
      currentStreak: newStreak,
      lastQuizParticipation: quizDateObj
    };

    if (newStreak > user.longestStreak) {
      updateData.longestStreak = newStreak;
    }

    await User.findByIdAndUpdate(userId, updateData);

    // Send streak milestone notifications
    if (newStreak >= 7 && newStreak % 7 === 0) {
      await sendStreakNotification(userId, newStreak, 'week');
    } else if (newStreak >= 30 && newStreak % 30 === 0) {
      await sendStreakNotification(userId, newStreak, 'month');
    } else if ([3, 5, 10, 15, 20, 25, 50, 100].includes(newStreak)) {
      await sendStreakNotification(userId, newStreak, 'milestone');
    }

    return newStreak;
  } catch (error) {
    console.error('Error updating user streak:', error);
    // Don't throw - streak updates shouldn't break quiz flow
  }
}

export async function getUserStreakStats(userId) {
  try {
    const user = await User.findById(userId).select('currentStreak longestStreak lastQuizParticipation');
    if (!user) return null;

    // Calculate streak health (days since last participation)
    let streakHealth = 'healthy';
    if (user.lastQuizParticipation) {
      const daysSinceLast = Math.floor((new Date() - new Date(user.lastQuizParticipation)) / (1000 * 60 * 60 * 24));
      if (daysSinceLast > 1) {
        streakHealth = 'broken';
      } else if (daysSinceLast === 1) {
        streakHealth = 'at_risk';
      }
    }

    return {
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastParticipation: user.lastQuizParticipation,
      streakHealth
    };
  } catch (error) {
    console.error('Error getting user streak stats:', error);
    return null;
  }
}

export async function generateReferralCode(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    if (user.referralCode) {
      return user.referralCode;
    }

    // Generate unique referral code using random bytes (hex) to avoid collisions at scale
    const crypto = await import('crypto');
    let referralCode;
    do {
      referralCode = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    } while (await User.findOne({ referralCode }));

    await User.findByIdAndUpdate(userId, { referralCode });
    return referralCode;
  } catch (error) {
    console.error('Error generating referral code:', error);
    return null;
  }
}

export async function processReferral(referrerCode, newUserId) {
  // This function is invoked when a logged‑in user opts to enter a referral code
  // after registration. It mirrors the registration referral handling.
  try {
    const referrer = await User.findOne({ referralCode: referrerCode });
    if (!referrer) return false;

    // Prevent self‑referral
    if (String(referrer._id) === String(newUserId)) {
      return false;
    }

    // Update referredBy on the user if not already set and if they haven't paid yet
    const user = await User.findById(newUserId);
    if (!user) return false;
    if (user.referredBy) {
      // already referred
      return false;
    }
    if (user.hasPaidBefore) {
      // cannot attach referral after payment
      return false;
    }

    user.referredBy = referrer._id;
    await user.save();

    // Create pending referral record
    const { default: Referral } = await import("./referral.model.js");
    await Referral.create({
      referrer: referrer._id,
      referredUser: newUserId,
      status: "PENDING",
      completedAt: null
    });

    // increment referrer stats
    await User.findByIdAndUpdate(referrer._id, {
      $inc: {
        'referralStats.totalReferrals': 1,
        referralCount: 1
      }
    });

    console.log(`Referral processed via code entry: ${referrer._id} referred ${newUserId}`);
    return true;
  } catch (error) {
    console.error('Error processing referral:', error);
    return false;
  }
}