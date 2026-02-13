// utils/email.js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

export async function sendEmailOTP(email, otp) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Daily Mind Education - OTP Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>OTP Verification</h2>
          <p>Your OTP for Daily Mind Education is:</p>
          <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          <p>This OTP will expire in 3 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`OTP email sent to ${email}`);
  } catch (error) {
    console.error('Failed to send OTP email:', error);
    throw new Error('Failed to send OTP email');
  }
}

export async function sendNotificationEmail(email, subject, message) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Daily Mind Education</h2>
          <p>${message}</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Notification email sent to ${email}`);
  } catch (error) {
    console.error('Failed to send notification email:', error);
    // Don't throw - notifications are not critical
  }
}

export async function sendPaymentSuccessEmail(email, userName, quizDate, amount) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Payment Successful - Daily Mind Education',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px;">
          <h2 style="color: #28a745;">Payment Successful! 🎉</h2>
          <p>Dear ${userName},</p>
          <p>Your payment of ₹${amount} for the quiz on ${quizDate} has been successfully processed.</p>
          <p>You are now eligible to participate in today's quiz at 8:00 PM IST.</p>
          <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <strong>Quiz Details:</strong><br>
            Date: ${quizDate}<br>
            Time: 8:00 PM IST<br>
            Duration: 15 minutes<br>
            Questions: 50 MCQs
          </div>
          <p>Get ready and good luck! 🧠</p>
          <p>Best regards,<br>Daily Mind Education Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Payment success email sent to ${email}`);
  } catch (error) {
    console.error('Failed to send payment success email:', error);
  }
}

export async function sendQuizResultEmail(email, userName, quizDate, score, rank, totalParticipants) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Quiz Results - ${quizDate}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px;">
          <h2>Your Quiz Results 📊</h2>
          <p>Dear ${userName},</p>
          <p>Here are your results for the quiz on ${quizDate}:</p>
          <div style="background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 5px; text-align: center;">
            <h3 style="margin: 0; color: #007bff;">Score: ${score}/50</h3>
            <p style="margin: 10px 0;">Rank: ${rank} out of ${totalParticipants} participants</p>
            <p style="margin: 10px 0;">Percentage: ${((score/50)*100).toFixed(1)}%</p>
          </div>
          ${rank <= 10 ? '<p style="color: #28a745; font-weight: bold;">🎉 Congratulations! You\'re in the top 10!</p>' : ''}
          <p>Keep practicing and improve your rank next time!</p>
          <p>Best regards,<br>Daily Mind Education Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Quiz result email sent to ${email}`);
  } catch (error) {
    console.error('Failed to send quiz result email:', error);
  }
}

export async function sendWeeklyDigestEmail(email, userName, weekStats) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Weekly Quiz Digest - Daily Mind Education',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px;">
          <h2>Weekly Quiz Digest 📈</h2>
          <p>Dear ${userName},</p>
          <p>Here's your quiz performance summary for this week:</p>
          <div style="background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 5px;">
            <p><strong>Quizzes Participated:</strong> ${weekStats.quizzesParticipated}</p>
            <p><strong>Average Score:</strong> ${weekStats.averageScore}/50 (${((weekStats.averageScore/50)*100).toFixed(1)}%)</p>
            <p><strong>Best Rank:</strong> ${weekStats.bestRank}</p>
            <p><strong>Improvement:</strong> ${weekStats.improvement > 0 ? '+' : ''}${weekStats.improvement} points from last week</p>
          </div>
          <p>Keep up the great work! 🧠</p>
          <p>Best regards,<br>Daily Mind Education Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Weekly digest email sent to ${email}`);
  } catch (error) {
    console.error('Failed to send weekly digest email:', error);
  }
}