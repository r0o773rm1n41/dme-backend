// // modules/quiz/quiz.scheduler.js
// modules/quiz/quiz.scheduler.js
import cron from "node-cron";
import * as QuizService from "./quiz.service.js";
import Quiz from "./quiz.model.js";

// ===============================
// Recover quiz state on server start
// ===============================
export async function recoverQuizState() {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const quiz = await Quiz.findOne({ quizDate: today });

    if (!quiz) {
      console.log(`[QUIZ] No quiz to recover for ${today}`);
      return;
    }

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Quiz should have ended but still LIVE
    if (quiz.state === "LIVE" && (hour > 20 || (hour === 20 && minute >= 30))) {
      console.log(`[RECOVERY] Ending quiz that should have completed for ${today}`);
      await QuizService.endQuiz(today);
    }
    // Quiz should have started but still not LIVE (could be LOCKED or PAYMENT_CLOSED)
    else if ((quiz.state === "LOCKED" || quiz.state === "PAYMENT_CLOSED") && (hour > 20 || (hour === 20 && minute >= 0))) {
      console.log(`[RECOVERY] Starting quiz that should be live for ${today}`);
      await QuizService.startQuiz(today);
    }
    // Quiz should be locked but still CREATED
    else if ((quiz.state === "SCHEDULED" || quiz.state === "DRAFT") && (hour > 19 || (hour === 19 && minute >= 50))) {
      console.log(`[RECOVERY] Locking quiz that should have been locked for ${today}`);
      await QuizService.lockQuiz(today);
    }
    // Quiz ended but winners not finalized
    else if ((quiz.state === "ENDED" || quiz.state === "CLOSED") && !quiz.finalizedAt) {
      console.log(`[RECOVERY] Finalizing winners for completed quiz ${today}`);
      await QuizService.finalizeWinners(today);
    }
  } catch (err) {
    console.error("[QUIZ] Error during crash recovery:", err);
  }
}

// ===============================
// Cron tasks
// ===============================
const scheduledTasks = [];

export function startQuizScheduler() {
  recoverQuizState();

  // 1️⃣ Snapshot eligible users at 19:55 IST
  scheduledTasks.push(
    cron.schedule(
      "55 19 * * *",
      async () => {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        try {
          await QuizService.snapshotEligibleUsers(today);
          console.log(`[CRON] Eligible users snapshotted for ${today}`);
        } catch (err) {
          console.error(`[CRON] Error snapshotting eligible users for ${today}:`, err);
        }
      },
      { timezone: "Asia/Kolkata" }
    )
  );

  // 2️⃣ Lock quiz at 19:50 IST
  scheduledTasks.push(
    cron.schedule(
      "50 19 * * *",
      async () => {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        try {
          await QuizService.lockQuiz(today);
          console.log(`[CRON] Quiz locked for ${today}`);
        } catch (err) {
          console.error(`[CRON] Error locking quiz for ${today}:`, err);
        }
      },
      { timezone: "Asia/Kolkata" }
    )
  );

  // 3️⃣ Start quiz at 20:00 IST
  scheduledTasks.push(
    cron.schedule(
      "0 20 * * *",
      async () => {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        try {
          await QuizService.startQuiz(today);
          console.log(`[CRON] Quiz started for ${today}`);
        } catch (err) {
          console.error(`[CRON] Error starting quiz for ${today}:`, err);
        }
      },
      { timezone: "Asia/Kolkata" }
    )
  );

  // 4️⃣ End quiz at 20:30 IST
  scheduledTasks.push(
    cron.schedule(
      "30 20 * * *",
      async () => {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        try {
          const quiz = await Quiz.findOne({ quizDate: today });
          if (!quiz) {
            console.log(`[CRON] No quiz found for ${today}, skipping endQuiz`);
            return;
          }

          if (quiz.state !== "LIVE") {
            console.log(`[CRON] Quiz ${today} is in state ${quiz.state}, skipping endQuiz`);
            return;
          }

          await QuizService.endQuiz(today);
          console.log(`[CRON] Quiz ended for ${today}`);
        } catch (err) {
          console.error(`[CRON] Error ending quiz for ${today}:`, err);
        }
      },
      { timezone: "Asia/Kolkata" }
    )
  );
}

// ===============================
// Stop cron tasks
// ===============================
export function stopQuizScheduler() {
  for (const t of scheduledTasks) {
    if (t && typeof t.stop === "function") t.stop();
  }
  scheduledTasks.length = 0;
  console.log("[QUIZ] Quiz scheduler stopped");
}






// import cron from "node-cron";
// import * as QuizService from "./quiz.service.js";
// import Quiz from "./quiz.model.js";
// import { sendQuizReminderNotifications } from "../notification/notification.service.js";

// export async function recoverQuizState() {
//   try {
//     const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
//     const quiz = await Quiz.findOne({ quizDate: today });

//     if (!quiz) return;

//     const now = new Date(Date.now());
//     const currentHour = now.getHours();
//     const currentMinute = now.getMinutes();

//     // Crash recovery logic
//     if (quiz.state === 'LIVE' && (currentHour > 20 || (currentHour === 20 && currentMinute >= 30))) {
//       // Quiz should have ended but didn't - recover
//       console.log('Crash recovery: Ending quiz that should have been completed');
//       await QuizService.endQuiz(today);
//     } else if (quiz.state === 'CREATED' && (currentHour > 20 || (currentHour === 20 && currentMinute >= 0))) {
//       // Quiz should have started but didn't - recover
//       console.log('Crash recovery: Starting quiz that should have been live');
//       await QuizService.startQuiz(today);
//     } else if (quiz.state === 'CREATED' && (currentHour > 19 || (currentHour === 19 && currentMinute >= 50))) {
//       // Quiz should have been locked but didn't - recover
//       console.log('Crash recovery: Locking quiz that should have been locked');
//       await QuizService.lockQuiz(today);
//     } else if ((quiz.state === 'ENDED' || quiz.state === 'CLOSED') && !quiz.finalizedAt) {
//       // Winners not finalized - recover
//       console.log('Crash recovery: Finalizing winners for completed quiz');
//       await QuizService.finalizeWinners(today);
//     }

//   } catch (error) {
//     console.error('Error during quiz state recovery:', error);
//   }
// }

// const scheduledTasks = [];

// export function startQuizScheduler() {
//   recoverQuizState();

//   scheduledTasks.push(cron.schedule("50 19 * * *", async () => {
//     const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
//     try {
//       await QuizService.lockQuiz(today);
//       console.log(`Quiz locked for ${today}`);
//     } catch (error) {
//       console.error('Error locking quiz:', error);
//     }
//   }, { timezone: 'Asia/Kolkata' }));

//   scheduledTasks.push(cron.schedule("0 20 * * *", async () => {
//     const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
//     try {
//       await QuizService.startQuiz(today);
//       console.log(`Quiz started for ${today}`);
//     } catch (error) {
//       console.error('Error starting quiz:', error);
//     }
//   }, { timezone: 'Asia/Kolkata' }));

//   scheduledTasks.push(cron.schedule("30 20 * * *", async () => {
//     const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
//     try {
//       const quiz = await Quiz.findOne({ quizDate: today });

//       if (!quiz) {
//         console.log(`[QUIZ] No quiz found for ${today}, skipping endQuiz`);
//         return;
//       }

//       if (quiz.state !== "LIVE") {
//         console.log(
//           `[QUIZ] Quiz ${today} is in state ${quiz.state}, skipping endQuiz`
//         );
//         return;
//       }

//       await QuizService.endQuiz(today);
//       console.log(`Quiz ended for ${today}`);
//     } catch (error) {
//       console.error('Error ending quiz:', error);
//     }
//   }, { timezone: 'Asia/Kolkata' }));

//   scheduledTasks.push(cron.schedule("55 19 * * *", async () => {
//     const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
//     try {
//       await QuizService.snapshotEligibleUsers(today);
//       console.log(`Eligible users snapshotted for ${today}`);
//     } catch (error) {
//       console.error('Error snapshotting eligible users:', error);
//     }
//   }, { timezone: 'Asia/Kolkata' }));
// }

// export function stopQuizScheduler() {
//   for (const t of scheduledTasks) {
//     if (t && typeof t.stop === 'function') t.stop();
//   }
//   scheduledTasks.length = 0;
//   console.log('Quiz scheduler stopped');
// }
