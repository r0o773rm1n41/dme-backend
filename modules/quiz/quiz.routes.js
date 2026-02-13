// modules/quiz/quiz.routes.js
import express from "express";
import * as QuizService from "./quiz.service.js";
import Winner from "./winner.model.js";
import { authRequired, eligibilityRequired } from "../../middlewares/auth.middleware.js";
import { quizAttemptRateLimit, quizAnswerRateLimit, quizListRateLimit, quizStatusRateLimit, quizQuestionRateLimit } from "../../middlewares/rate-limit.middleware.js";
import redis from "../../config/redis.js";
import { validate, quizSchemas } from "../../utils/validation.js";

const router = express.Router();

// Middleware to enforce eligibility for quiz actions
const enforceEligibility = async (req, res, next) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const user = req.user;

    if (!user.quizEligibility?.isEligible || user.quizEligibility.eligibleDate !== today) {
      return res.status(403).json({ message: "User not eligible for this quiz" });
    }

    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// C2: Normalized API endpoint - GET /quiz/today
router.get("/today", authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await QuizService.getTodayQuiz(today, req.user._id);
    
    if (!quiz) {
      // Check if quiz exists but user's class doesn't match
      const Quiz = (await import('./quiz.model.js')).default;
      const anyQuiz = await Quiz.findOne({ quizDate: today });
      if (anyQuiz) {
        // Quiz exists but not for this user's class
        const User = (await import('../user/user.model.js')).default;
        const user = await User.findById(req.user._id).select('classGrade');
        return res.json({ 
          success: true,
          data: { 
            exists: false, 
            quiz: null
          },
          meta: { 
            message: `No quiz available for your class. This quiz is for ${anyQuiz.classGrade} class. Your class: ${user?.classGrade || 'Not set'}.`
          }
        });
      }
      return res.json({ 
        success: true, 
        data: { exists: false, quiz: null },
        meta: { quizDate: today }
      });
    }

    // Check if user has participated
    const QuizAttempt = (await import('./quizAttempt.model.js')).default;
    const attempt = await QuizAttempt.findOne({ user: req.user._id, quizDate: today });

    // Check eligibility
    const { getEffectiveEligibility } = await import('../payment/payment.service.js');
    const eligibility = await getEffectiveEligibility(req.user._id, today);

    // Check if quiz is live
    const isLive = quiz.state === 'LIVE';
    const isCompleted = quiz.state === 'RESULT_PUBLISHED' || quiz.state === 'ENDED' || quiz.state === 'CLOSED';
    const userParticipated = !!attempt?.answersSaved;

    // C2: Normalized response contract
    res.json({
      success: true,
      data: {
        exists: true,
        quiz: {
          _id: quiz._id,
          quizDate: quiz.quizDate,
          state: quiz.state,
          isLive,
          isCompleted,
          totalQuestions: quiz.questions?.length || 50,
          userParticipated,
          userEligible: eligibility.eligible,
          classGrade: quiz.classGrade || 'ALL',
          lockedAt: quiz.lockedAt,
          liveAt: quiz.liveAt,
          endedAt: quiz.endedAt
        }
      },
      meta: { quizDate: today }
    });
  } catch (error) {
    // C2: Normalized error response
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Check eligibility for today's quiz
router.get("/eligibility", authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { isUserEligible } = await import('../payment/payment.service.js');
    const eligible = await isUserEligible(req.user._id, today);
    
    // Check if quiz is live
    const quiz = await QuizService.getTodayQuiz(today);
    const quizNotLiveYet = !quiz || quiz.state !== 'LIVE';

    res.json({
      eligible,
      quizNotLiveYet,
      message: eligible 
        ? "You are eligible to participate" 
        : "Payment required to participate"
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Enter quiz (create attempt) - Allow all users to view/attempt, but only paid users' answers count
router.post("/enter", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { quizId } = req.body;

    // Verify quiz exists and is live
    const quiz = await QuizService.getTodayQuiz(today);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found for today' });
    }

    // Check class grade matching
    const User = (await import('../user/user.model.js')).default;
    const user = await User.findById(req.user._id);
    
    // Check if profile is complete (required before quiz participation)
    const { isProfileComplete } = await import('../../utils/quizEligibility.js');
    if (!isProfileComplete(user)) {
      return res.status(403).json({ 
        message: 'Please complete your profile first (Name, Username, Age, Class, School, Gender) before participating in quiz.',
        requiresProfileCompletion: true
      });
    }
    
    if (quiz.classGrade && quiz.classGrade !== 'ALL' && user.classGrade !== quiz.classGrade) {
      return res.status(403).json({ 
        message: `This quiz is for ${quiz.classGrade} class students only. Your class: ${user.classGrade || 'Not set'}` 
      });
    }

    if (quiz.state !== 'LIVE') {
      return res.status(403).json({ message: 'Quiz is not live yet' });
    }

    // Check eligibility
    const { isUserEligible } = await import('../payment/payment.service.js');
    const eligible = await isUserEligible(req.user._id, today);
    
    const deviceInfo = {
      deviceId: req.body?.deviceId,
      deviceFingerprint: req.body?.deviceFingerprint,
      ipAddress: req.ip || req.connection.remoteAddress
    };
    const attempt = await QuizService.createQuizAttempt(req.user._id, today, deviceInfo);
    
    res.json({ 
      success: true, 
      attempt,
      eligible,
      message: eligible 
        ? 'You are eligible - your answers will count'
        : 'You can view and attempt the quiz, but your answers will NOT count until you make payment'
    });
  } catch (error) {
    if (error.message.includes('already started')) {
      return res.status(400).json({ message: error.message, alreadyParticipated: true });
    }
    res.status(400).json({ message: error.message });
  }
});

// C1: REMOVED /status/:quizDate - use /status instead (normalized endpoint)

// C1: REMOVED /join/:quizDate - use /join instead (normalized endpoint)

// C1: REMOVED /answer/:quizDate - use /answer instead (normalized endpoint)

router.get("/state/:quizDate", authRequired, async (req, res) => {
  try {
    const QuizAttempt = (await import('./quizAttempt.model.js')).default;
    const attempt = await QuizAttempt.findOne({
      user: req.user._id,
      quizDate: req.params.quizDate
    }).select('currentQuestionIndex answers answersSaved startedAt updatedAt');

    if (!attempt) return res.status(404).json({ message: 'Quiz attempt not found' });

    const payload = {
      currentQuestionIndex: attempt.currentQuestionIndex,
      answeredCount: attempt.answers?.length || 0,
      totalQuestions: 50,
      startedAt: attempt.startedAt,
      answersSaved: attempt.answersSaved
    };
    const etag = `"${attempt.updatedAt?.getTime() || Date.now()}-${payload.answeredCount}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, max-age=2');
    if (req.get('If-None-Match') === etag) {
      return res.status(304).end();
    }
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/question/:quizDate/:questionIndex", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const questionIndex = parseInt(req.params.questionIndex);
    const question = await QuizService.getNextQuestion(req.user._id, req.params.quizDate, questionIndex);
    res.json(question);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// C1, C2: Normalized API endpoint - POST /quiz/finish
router.post("/finish", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const attempt = await QuizService.finalizeQuizAttempt(req.user._id, today);
    
    // C2: Normalized response contract
    res.json({
      success: true,
      data: {
        score: attempt.score,
        counted: attempt.counted,
        isEligible: attempt.isEligible
      },
      meta: { quizDate: today }
    });
  } catch (error) {
    // C2: Normalized error response
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// C2: Normalized API endpoint - GET /quiz/leaderboard/:quizDate
router.get("/leaderboard/:quizDate", quizListRateLimit, async (req, res) => {
  try {
    const leaderboard = await QuizService.getLeaderboard(req.params.quizDate);
    // C2: Normalized response contract
    res.json({
      success: true,
      data: leaderboard,
      meta: { quizDate: req.params.quizDate }
    });
  } catch (error) {
    // C2: Normalized error response
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get winners (all or by date)
router.get("/winners", quizListRateLimit, async (req, res) => {
  try {
    const { quizDate } = req.query;
    
    // Get today's date in YYYY-MM-DD format (IST timezone)
    let today = quizDate;
    if (!today) {
      const now = new Date();
      const istDate = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
      today = istDate.toISOString().split('T')[0];
    }
    
    console.log(`[WINNERS API] Fetching winners for: ${today}`);
    
    const cacheKey = `winners:${today}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        console.log(`[WINNERS API] Returning cached data for ${today}`);
        const parsed = JSON.parse(cached);
        return res.json({
          success: true,
          winners: parsed,
          quizDate: today,
          totalParticipants: parsed.length,
          resultPublished: true
        });
      } catch (parseError) {
        console.warn('Invalid cached data, fetching from DB');
      }
    }
    
    // Query winners by date
    const query = { quizDate: today };
    const winners = await Winner.find(query)
      .populate("user", "name profileImage fullName username classGrade")
      .sort({ rank: 1 })
      .lean()
      .limit(30);
    
    console.log(`[WINNERS API] Found ${winners.length} winners for ${today}`);
    
    if (!winners || winners.length === 0) {
      return res.json({
        success: true,
        winners: [],
        quizDate: today,
        totalParticipants: 0,
        resultPublished: false,
        message: `No results published for ${today}`
      });
    }
    
    // Transform winners data
    const result = winners.map((w, idx) => {
      const userData = w.userId || w.author || w.user || {};
      return {
        _id: w._id,
        rank: w.rank || (idx + 1),
        score: w.score || 0,
        totalTimeMs: w.totalTimeMs || 0,
        totalTimeSec: Math.floor((w.totalTimeMs || 0) / 1000),
        accuracy: w.accuracy || (w.score > 0 ? ((w.score / 100) * 100).toFixed(2) : 0),
        user: {
          _id: userData._id || w.userId,
          name: userData.name || userData.fullName || 'Unknown',
          username: userData.username || `user_${idx}`,
          profileImage: userData.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name || 'User')}`
        },
        quizDate: w.quizDate
      };
    });
    
    // Cache for 10 minutes
    await redis.set(cacheKey, JSON.stringify(result), { ex: 600 });
    
    res.json({
      success: true,
      winners: result,
      quizDate: today,
      totalParticipants: result.length,
      resultPublished: true
    });
  } catch (error) {
    console.error(`[WINNERS API ERROR]: ${error.message}`);
    res.status(500).json({ 
      success: false,
      message: error.message,
      winners: []
    });
  }
});

// C1: REMOVED /submit - use /finish/:quizDate instead (normalized endpoint)

// Get user's quiz history (list of all attempts)
router.get("/history", authRequired, async (req, res) => {
  try {
    const analytics = await QuizService.getUserQuizAnalytics(req.user._id);
    res.json({
      quizHistory: analytics.quizHistory || []
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get live analytics for a specific quiz (for quiz analytics page)
router.get("/analytics/:quizId", authRequired, async (req, res) => {
  try {
    const { quizId } = req.params;
    // Get the quiz details
    const Quiz = (await import('./quiz.model.js')).default;
    const quiz = await Quiz.findById(quizId);
    
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    // Get all attempts for this quiz
    const QuizAttempt = (await import('./quizAttempt.model.js')).default;
    const attempts = await QuizAttempt.find({ quizDate: quiz.quizDate }).populate('user', 'name username');

    // Get user's personal attempt
    const userAttempt = attempts.find(a => a.user._id.toString() === req.user._id.toString());

    // Calculate analytics
    const totalAttempts = attempts.length;
    const avgScore = attempts.length > 0 ? Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length) : 0;
    const maxScore = attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : 0;
    
    // Get current question index (find the highest question index that has been answered by any participant)
    const currentQuestionIndex = attempts.length > 0 
      ? Math.max(...attempts.map(a => a.currentQuestionIndex || 0))
      : 0;

    res.json({
      quiz: {
        _id: quiz._id,
        title: quiz.title || `Quiz on ${quiz.quizDate}`,
        quizDate: quiz.quizDate,
        state: quiz.state
      },
      analytics: {
        totalParticipants: totalAttempts,
        participantsAnswered: attempts.filter(a => a.submitted).length,
        currentQuestionIndex: currentQuestionIndex,
        totalQuestions: 50, // Standard quiz has 50 questions
        averageScore: avgScore,
        maxScore,
        participantCount: totalAttempts,
        liveCount: attempts.filter(a => !a.submitted).length
      },
      userAttempt: userAttempt ? {
        score: userAttempt.score,
        answered: userAttempt.answers ? userAttempt.answers.length : 0,
        submitted: userAttempt.submitted,
        rank: null
      } : null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/analytics", authRequired, async (req, res) => {
  try {
    const analytics = await QuizService.getUserQuizAnalytics(req.user._id);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Save quiz progress
router.post("/progress/:quizDate", authRequired, async (req, res) => {
  try {
    const { currentQuestionIndex, answers, answerTimestamps, questionStartTimes, timeRemaining } = req.body;
    const progress = await QuizService.saveQuizProgress(req.user._id, req.params.quizDate, {
      currentQuestionIndex,
      answers,
      answerTimestamps,
      questionStartTimes,
      timeRemaining
    });
    res.json(progress);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Load quiz progress
router.get("/progress/:quizDate", authRequired, async (req, res) => {
  try {
    const progress = await QuizService.loadQuizProgress(req.user._id, req.params.quizDate);
    res.json(progress || { currentQuestionIndex: 0, answers: [], answerTimestamps: [], questionStartTimes: [], timeRemaining: 900000 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// C1, C2: Normalized API endpoint - POST /quiz/join
router.post("/join", authRequired, quizAttemptRateLimit, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const deviceInfo = {
      deviceId: req.body?.deviceId,
      deviceFingerprint: req.body?.deviceFingerprint,
      ipAddress: req.ip || req.connection.remoteAddress
    };
    const attempt = await QuizService.createQuizAttempt(req.user._id, today, deviceInfo);
    
    // C2: Normalized response contract
    res.json({ 
      success: true, 
      data: { attemptId: attempt._id },
      meta: { quizDate: today }
    });
  } catch (error) {
    // C2: Normalized error response
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// C1, C2: Normalized API endpoint - GET /quiz/status
router.get("/status", quizStatusRateLimit, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await QuizService.getTodayQuiz(today);
    const state = quiz ? quiz.state : 'NO_QUIZ';
    const etag = `"${state}-${today}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, max-age=5');
    res.set('X-Poll-Interval', '5');
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    if (!quiz) {
      return res.json({ success: true, data: { state: 'NO_QUIZ' }, meta: { quizDate: today } });
    }
    res.json({ success: true, data: { state: quiz.state, quizDate: quiz.quizDate }, meta: { quizDate: today } });
  } catch (error) {
    // C2: Normalized error response
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// C2: Normalized API endpoint - GET /quiz/current-question
router.get("/current-question", authRequired, quizQuestionRateLimit, async (req, res) => {
  try {
    const question = await QuizService.getCurrentQuestion(req.user._id);
    // C2: Normalized response contract
    res.json({
      success: true,
      data: question,
      meta: {}
    });
  } catch (error) {
    if (error.message === 'Quiz not live' || error.message === 'Quiz ended') {
      return res.status(404).json({ 
        success: false, 
        error: error.message 
      });
    }
    // C2: Normalized error response
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// C1, C2: Normalized API endpoint - POST /quiz/answer
router.post("/answer", authRequired, quizAnswerRateLimit, async (req, res) => {
  try {
    const { questionId, selectedOptionIndex, deviceId, deviceFingerprint } = req.body;
    
    // Extract device info for validation
    const deviceInfo = {
      deviceId,
      deviceFingerprint,
      ipAddress: req.ip || req.connection.remoteAddress
    };
    
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const result = await QuizService.submitAnswer(req.user._id, questionId, selectedOptionIndex, deviceInfo);
    
    // Check if user is eligible - return this info to frontend
    const { getEffectiveEligibility } = await import('../payment/payment.service.js');
    const eligibility = await getEffectiveEligibility(req.user._id, today);
    
    // C2: Normalized response contract
    res.json({
      success: true,
      data: {
        isCorrect: result.isCorrect,
        countsForScore: result.countsForScore,
        alreadyAnswered: result.alreadyAnswered || false,
        eligible: eligibility.eligible
      },
      meta: { quizDate: today }
    });
  } catch (error) {
    // Handle already answered case gracefully
    if (error.message.includes('already answered') || error.message.includes('already submitted')) {
      return res.json({ 
        success: true, 
        data: { alreadyAnswered: true },
        meta: {}
      });
    }
    // C2: Normalized error response
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET /quiz/result
router.get("/result", authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const result = await QuizService.getLeaderboard(today);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
