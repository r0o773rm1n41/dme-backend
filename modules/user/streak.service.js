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

    // Generate unique referral code
    const baseCode = user.name.replace(/\s+/g, '').substring(0, 8).toUpperCase();
    let referralCode = baseCode;
    let counter = 1;

    while (await User.findOne({ referralCode })) {
      referralCode = `${baseCode}${counter}`;
      counter++;
    }

    await User.findByIdAndUpdate(userId, { referralCode });
    return referralCode;
  } catch (error) {
    console.error('Error generating referral code:', error);
    return null;
  }
}

export async function processReferral(referrerCode, newUserId) {
  try {
    const referrer = await User.findOne({ referralCode: referrerCode });
    if (!referrer) return false;

    // Update referral relationships
    await User.findByIdAndUpdate(newUserId, { referredBy: referrer._id });
    await User.findByIdAndUpdate(referrer._id, { $inc: { referralCount: 1 } });

    // Award referral bonus (could be quiz entries, streak bonus, etc.)
    // For now, just log it - actual rewards can be implemented in winner calculation
    console.log(`Referral processed: ${referrer._id} referred ${newUserId}`);

    return true;
  } catch (error) {
    console.error('Error processing referral:', error);
    return false;
  }
}