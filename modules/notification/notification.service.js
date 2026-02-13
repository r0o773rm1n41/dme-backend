// modules/notification/notification.service.js
import User from "../user/user.model.js";
import Payment from "../payment/payment.model.js";
import { sendNotificationEmail, sendPaymentSuccessEmail, sendQuizResultEmail, sendWeeklyDigestEmail } from "../../utils/email.js";
import { sendPushNotification, sendMulticastNotification } from "./firebase.service.js";

/**
 * Send quiz start reminder to all eligible users
 * @param {string} quizDate - Date in YYYY-MM-DD format
 */
export async function sendQuizReminderNotifications(quizDate) {
  try {
    // Find all users who have paid for today's quiz
    const eligibleUsers = await Payment.find({
      quizDate,
      status: "SUCCESS"
    }).populate('user', 'phone name fcmToken').select('user');

    if (eligibleUsers.length === 0) {
      console.log(`No eligible users found for quiz ${quizDate}`);
      return;
    }

    const userPhones = eligibleUsers.map(p => p.user.phone);
    console.log(`Sending quiz reminders to ${eligibleUsers.length} eligible users:`, userPhones);

    // Send push notifications to users with FCM tokens
    const fcmTokens = eligibleUsers
      .map(p => p.user.fcmToken)
      .filter(token => token); // Remove null/undefined tokens

    if (fcmTokens.length > 0) {
      const pushResult = await sendMulticastNotification(
        fcmTokens,
        'Quiz Starting Soon!',
        `Your daily quiz for ${quizDate} starts in 30 minutes. Get ready!`,
        {
          type: 'quiz_reminder',
          quizDate,
          action: 'open_quiz'
        }
      );
      console.log(`Push notifications sent: ${pushResult.success} success, ${pushResult.failure} failures`);
    }

    // Send SMS notifications (existing logic)
    // TODO: Integrate SMS service for reminders

    // Send email notifications
    try {
      for (const payment of eligibleUsers) {
        const user = payment.user;
        if (user.email) {
          await sendNotificationEmail(
            user.email,
            'Quiz Reminder',
            `Dear ${user.name},\n\nYour daily quiz for ${quizDate} starts in 30 minutes at 8:00 PM IST.\n\nGet ready and good luck!\n\nBest regards,\nDaily Mind Education Team`
          );
        }
      }
    } catch (emailError) {
      console.error('Failed to send email reminders:', emailError);
    }

    return {
      success: true,
      recipients: eligibleUsers.length,
      pushSent: fcmTokens.length,
      quizDate
    };

  } catch (error) {
    console.error('Error sending quiz reminder notifications:', error);
    throw error;
  }
}

/**
 * Send payment success notification
 * @param {ObjectId} userId - User ID
 * @param {string} quizDate - Quiz date
 */
export async function sendPaymentSuccessNotification(userId, quizDate) {
  try {
    const user = await User.findById(userId).select('phone name email fcmToken');
    if (!user) return;

    console.log(`Sending payment success notification to ${user.phone} for quiz ${quizDate}`);

    // Send push notification
    if (user.fcmToken) {
      await sendPushNotification(
        user.fcmToken,
        'Payment Successful! 🎉',
        'Your payment has been confirmed. You\'re now eligible for today\'s quiz.',
        {
          type: 'payment_success',
          quizDate,
          action: 'open_quiz'
        }
      );
    }

    // Send email notification
    if (user.email) {
      await sendPaymentSuccessEmail(user.email, user.name, quizDate, 5);
    }

    // TODO: Send SMS notification
    // await sendSMS(user.phone, `Payment confirmed! You're eligible for today's quiz at 8 PM IST.`);

    return { success: true, user: user.phone };
  } catch (error) {
    console.error('Error sending payment success notification:', error);
    throw error;
  }
}

/**
 * Send quiz completion notification with results
 * @param {ObjectId} userId - User ID
 * @param {Object} results - Quiz results
 */
export async function sendQuizCompletionNotification(userId, results) {
  try {
    const user = await User.findById(userId).select('phone name email fcmToken');
    if (!user) return;

    // Send push notification
    if (user.fcmToken) {
      await sendPushNotification(
        user.fcmToken,
        'Quiz Completed! 📊',
        `Your score: ${results.score}/50. Check rankings now!`,
        {
          type: 'quiz_completed',
          score: results.score,
          totalQuestions: 50,
          action: 'view_results'
        }
      );
    }

    // Send email notification
    if (user.email) {
      await sendQuizResultEmail(
        user.email,
        user.name,
        results.quizDate,
        results.score,
        results.rank,
        results.totalParticipants
      );
    }

    console.log(`Quiz completion notifications sent to ${user.phone}: Score ${results.score}/50`);

    return { success: true, user: user.phone, score: results.score };
  } catch (error) {
    console.error('Error sending quiz completion notification:', error);
    throw error;
  }
}

/**
 * Send weekly digest notification to all active users
 */
export async function sendWeeklyDigestNotifications() {
  try {
    // Find users who participated in quizzes this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const activeUsers = await User.find({
      createdAt: { $gte: weekAgo },
      email: { $exists: true, $ne: null }
    }).select('name email fcmToken');

    console.log(`Sending weekly digest to ${activeUsers.length} active users`);

    // For each user, calculate their weekly stats
    for (const user of activeUsers) {
      try {
        // This would need to be implemented based on your quiz attempt history
        // For now, sending a placeholder digest
        const weekStats = {
          quizzesParticipated: 5, // Placeholder
          averageScore: 35, // Placeholder
          bestRank: 15, // Placeholder
          improvement: 3 // Placeholder
        };

        // Send email digest
        if (user.email) {
          await sendWeeklyDigestEmail(user.email, user.name, weekStats);
        }

        // Send push notification
        if (user.fcmToken) {
          await sendPushNotification(
            user.fcmToken,
            'Weekly Quiz Digest 📈',
            `This week: ${weekStats.quizzesParticipated} quizzes, avg score: ${weekStats.averageScore}/50`,
            {
              type: 'weekly_digest',
              quizzesParticipated: weekStats.quizzesParticipated,
              averageScore: weekStats.averageScore,
              action: 'view_stats'
            }
          );
        }
      } catch (userError) {
        console.error(`Failed to send digest to user ${user._id}:`, userError);
      }
    }

    return { success: true, recipients: activeUsers.length };
  } catch (error) {
    console.error('Error sending weekly digest notifications:', error);
    throw error;
  }
}

/**
 * Send streak milestone notification to user
 * @param {string} userId - User ID
 * @param {number} streakCount - Current streak count
 * @param {string} milestoneType - Type of milestone ('week', 'month', 'milestone')
 */
export async function sendStreakNotification(userId, streakCount, milestoneType) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.fcmToken) return;

    let title, body;
    switch (milestoneType) {
      case 'week':
        title = '🎯 Weekly Streak Achievement!';
        body = `Amazing! You've maintained a ${streakCount}-day streak. Keep it up!`;
        break;
      case 'month':
        title = '🏆 Monthly Streak Champion!';
        body = `Incredible! ${streakCount} days in a row. You're unstoppable!`;
        break;
      case 'milestone':
        title = '⭐ Streak Milestone Reached!';
        body = `${streakCount} consecutive days! You're building great habits!`;
        break;
      default:
        title = '🔥 Streak Update!';
        body = `Current streak: ${streakCount} days. Keep going!`;
    }

    await sendPushNotification(user.fcmToken, title, body);
    console.log(`Streak notification sent to ${user.phoneNumber}: ${streakCount} days`);
  } catch (error) {
    console.error('Error sending streak notification:', error);
  }
}