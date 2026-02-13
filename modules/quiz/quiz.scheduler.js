// modules/quiz/quiz.scheduler.js
import cron from "node-cron";
import * as QuizService from "./quiz.service.js";
import Quiz from "./quiz.model.js";
import { sendQuizReminderNotifications } from "../notification/notification.service.js";

export async function recoverQuizState() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await Quiz.findOne({ quizDate: today });

    if (!quiz) return;

    const now = new Date(Date.now());
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Crash recovery logic
    if (quiz.state === 'LIVE' && (currentHour > 20 || (currentHour === 20 && currentMinute >= 30))) {
      // Quiz should have ended but didn't - recover
      console.log('Crash recovery: Ending quiz that should have been completed');
      await QuizService.endQuiz(today);
    } else if (quiz.state === 'CREATED' && (currentHour > 20 || (currentHour === 20 && currentMinute >= 0))) {
      // Quiz should have started but didn't - recover
      console.log('Crash recovery: Starting quiz that should have been live');
      await QuizService.startQuiz(today);
    } else if (quiz.state === 'CREATED' && (currentHour > 19 || (currentHour === 19 && currentMinute >= 50))) {
      // Quiz should have been locked but didn't - recover
      console.log('Crash recovery: Locking quiz that should have been locked');
      await QuizService.lockQuiz(today);
    } else if ((quiz.state === 'ENDED' || quiz.state === 'CLOSED') && !quiz.finalizedAt) {
      // Winners not finalized - recover
      console.log('Crash recovery: Finalizing winners for completed quiz');
      await QuizService.finalizeWinners(today);
    }

  } catch (error) {
    console.error('Error during quiz state recovery:', error);
  }
}

const scheduledTasks = [];

export function startQuizScheduler() {
  recoverQuizState();

  scheduledTasks.push(cron.schedule("50 19 * * *", async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    try {
      await QuizService.lockQuiz(today);
      console.log(`Quiz locked for ${today}`);
    } catch (error) {
      console.error('Error locking quiz:', error);
    }
  }, { timezone: 'Asia/Kolkata' }));

  scheduledTasks.push(cron.schedule("0 20 * * *", async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    try {
      await QuizService.startQuiz(today);
      console.log(`Quiz started for ${today}`);
    } catch (error) {
      console.error('Error starting quiz:', error);
    }
  }, { timezone: 'Asia/Kolkata' }));

  scheduledTasks.push(cron.schedule("30 20 * * *", async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    try {
      const quiz = await Quiz.findOne({ quizDate: today });

      if (!quiz) {
        console.log(`[QUIZ] No quiz found for ${today}, skipping endQuiz`);
        return;
      }

      if (quiz.state !== "LIVE") {
        console.log(
          `[QUIZ] Quiz ${today} is in state ${quiz.state}, skipping endQuiz`
        );
        return;
      }

      await QuizService.endQuiz(today);
      console.log(`Quiz ended for ${today}`);
    } catch (error) {
      console.error('Error ending quiz:', error);
    }
  }, { timezone: 'Asia/Kolkata' }));

  scheduledTasks.push(cron.schedule("55 19 * * *", async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    try {
      await QuizService.snapshotEligibleUsers(today);
      console.log(`Eligible users snapshotted for ${today}`);
    } catch (error) {
      console.error('Error snapshotting eligible users:', error);
    }
  }, { timezone: 'Asia/Kolkata' }));
}

export function stopQuizScheduler() {
  for (const t of scheduledTasks) {
    if (t && typeof t.stop === 'function') t.stop();
  }
  scheduledTasks.length = 0;
  console.log('Quiz scheduler stopped');
}
