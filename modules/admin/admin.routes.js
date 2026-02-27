// modules/admin/admin.routes.js
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import Quiz from "../quiz/quiz.model.js";
import Question from "../quiz/question.model.js";
import Winner from "../quiz/winner.model.js";
import QuizAttempt from "../quiz/quizAttempt.model.js";
import User from "../user/user.model.js";
import Payment from "../payment/payment.model.js";
import * as BlogService from "../blog/blog.service.js";
import { authRequired, roleRequired } from "../../middlewares/auth.middleware.js";
import * as QuizService from "../quiz/quiz.service.js";
import { logAdminAction, getAdminAuditLog, getAuditTrail } from "./adminAudit.service.js";

const router = express.Router();

// Configure multer for CSV upload
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Apply admin role check to all routes
router.use(authRequired, roleRequired(["QUIZ_ADMIN", "CONTENT_ADMIN", "SUPER_ADMIN"]));

// Get all quizzes for admin management
router.get("/quiz", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (status) {
      filter.state = status;
    }

    const quizzes = await Quiz.find(filter)
      .sort({ quizDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('quizDate title description questions state classGrade createdAt')
      .lean();

    const total = await Quiz.countDocuments(filter);

    const formattedQuizzes = quizzes.map(quiz => ({
      _id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      questions: Array.isArray(quiz.questions) ? quiz.questions.length : (quiz.totalQuestions || 0),
      quizDate: quiz.quizDate,
      state: quiz.state,
      classGrade: quiz.classGrade,
      createdAt: quiz.createdAt
    }));

    res.json({
      quizzes: formattedQuizzes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Edit quiz (update title, description, classGrade)
router.put("/quiz/:quizDate", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { quizDate } = req.params;
    const { title, description, classGrade } = req.body;

    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const lockTime = new Date(istTime);
    lockTime.setHours(19, 50, 0, 0); // 7:50 PM IST

    // Prevent quiz modification after 7:50 PM IST for today's quiz
    if (quizDate === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) && istTime >= lockTime) {
      return res.status(400).json({
        message: 'Quiz questions are locked after 7:50 PM IST. No modifications allowed.'
      });
    }

    const quiz = await Quiz.findOne({ quizDate });

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Only prevent modification if quiz is LIVE (currently running)
    if (quiz.state === 'LIVE') {
      return res.status(400).json({ message: 'Cannot modify quiz while it is live' });
    }

    // Validate classGrade
    if (classGrade && !['10th', '12th', 'Other', 'ALL'].includes(classGrade)) {
      return res.status(400).json({
        message: 'Invalid classGrade. Must be one of: 10th, 12th, Other, ALL'
      });
    }

    // Update allowed fields
    if (title !== undefined) quiz.title = title;
    if (description !== undefined) quiz.description = description;
    if (classGrade !== undefined) quiz.classGrade = classGrade;

    await quiz.save();

    await logAdminAction(req.user._id, 'QUIZ_UPDATED', 'QUIZ', quiz.quizDate, { title: quiz.title, description: quiz.description }, req);
    res.json(quiz);
  } catch (error) {
    console.error('Quiz update error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Bulk create questions (QUIZ_ADMIN or SUPER_ADMIN)
router.post("/questions/bulk", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        message: 'Questions array is required and must not be empty'
      });
    }

    // Validate each question
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 ||
          typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) {
        return res.status(400).json({
          message: `Question ${i + 1} is invalid. Each question must have: question text, 4 options array, and correctIndex (0-3).`
        });
      }
    }

    // Create questions in bulk
    const createdQuestions = await Question.insertMany(questions);

    // Return the IDs as strings
    const questionIds = createdQuestions.map(q => q._id.toString());

    // Note: Admin audit logging for questions creation is skipped for now
    // await logAdminAction(req.user._id, 'QUESTIONS_CREATED', 'QUESTION', null, { count: questionIds.length }, req);

    res.json({
      message: `Successfully created ${questionIds.length} questions`,
      questionIds: questionIds
    });
  } catch (error) {
    console.error('Bulk questions creation error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Quiz management (QUIZ_ADMIN or SUPER_ADMIN)
router.post("/quiz", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { quizDate, title, description, questions, classGrade } = req.body;
    
    // Use provided quizDate or default to today
    const targetDate = quizDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const lockTime = new Date(istTime);
    lockTime.setHours(19, 50, 0, 0); // 7:50 PM IST

    // Prevent quiz creation/modification after 7:50 PM IST for today's quiz
    if (targetDate === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) && istTime >= lockTime) {
      return res.status(400).json({
        message: 'Quiz questions are locked after 7:50 PM IST. No modifications allowed.'
      });
    }

    // Validate that exactly 50 question IDs are provided
    if (!questions || !Array.isArray(questions) || questions.length !== 50) {
      return res.status(400).json({
        message: 'Quiz must have exactly 50 question IDs. Please provide all 50 question IDs.'
      });
    }

    // Validate that all questions are valid ObjectIds and exist
    for (let i = 0; i < questions.length; i++) {
      const questionId = questions[i];
      if (!mongoose.Types.ObjectId.isValid(questionId)) {
        return res.status(400).json({
          message: `Question ID ${i + 1} is not a valid ObjectId: ${questionId}`
        });
      }
    }

    // Verify all questions exist
    const existingQuestions = await Question.find({
      _id: { $in: questions }
    });

    if (existingQuestions.length !== questions.length) {
      return res.status(400).json({
        message: `Some questions do not exist. Found ${existingQuestions.length} out of ${questions.length} questions.`
      });
    }

    // Validate classGrade
    if (classGrade && !['10th', '12th', 'Other', 'ALL'].includes(classGrade)) {
      return res.status(400).json({
        message: 'Invalid classGrade. Must be one of: 10th, 12th, Other, ALL'
      });
    }

    const existingQuiz = await Quiz.findOne({ quizDate: targetDate });

    // Only prevent modification if quiz is LIVE (currently running)
    if (existingQuiz && existingQuiz.state === 'LIVE') {
      return res.status(400).json({ message: 'Cannot modify quiz while it is live' });
    }

    // Delete existing quiz if it's in DRAFT, ENDED, or RESULT_PUBLISHED state (allows recreation)
    if (existingQuiz && ['DRAFT', 'ENDED', 'RESULT_PUBLISHED'].includes(existingQuiz.state)) {
      await Quiz.deleteOne({ _id: existingQuiz._id });
    }

    // Create quiz with question IDs
    const quiz = await Quiz.create({
      quizDate: targetDate,
      title: title || 'Daily Quiz',
      description: description || 'Daily 50 Question Quiz',
      questions: questions,
      state: 'SCHEDULED',
      classGrade: classGrade || 'ALL',
    });

    await logAdminAction(req.user._id, 'QUIZ_CREATED', 'QUIZ', quiz.quizDate, { questionsCount: quiz.questions.length, title: quiz.title }, req);
    res.json(quiz);
  } catch (error) {
    console.error('Quiz creation error:', error);
    res.status(400).json({ message: error.message });
  }
});

// CSV Upload for Quiz Questions (QUIZ_ADMIN or SUPER_ADMIN)
router.post("/quiz/upload", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), upload.single('csv'), async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const lockTime = new Date(istTime);
    lockTime.setHours(19, 50, 0, 0); // 7:50 PM IST

    // Prevent quiz creation/modification after 7:50 PM IST
    if (istTime >= lockTime) {
      return res.status(400).json({
        message: 'Quiz questions are locked after 7:50 PM IST. No modifications allowed.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'CSV file is required' });
    }

    // Parse CSV file using csv-parser
    const fs = await import('fs');
    const { default: csv } = await import('csv-parser');
    
    const questions = [];
    let rowCount = 0;
    
    return new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          rowCount++;
          // Skip header
          if (rowCount === 1) return;
          
          const { question, optionA, optionB, optionC, optionD, correctAnswer } = row;
          
          if (!question || !optionA || !optionB || !optionC || !optionD || correctAnswer === undefined) {
            reject(new Error(`Invalid CSV format at row ${rowCount}. Missing required fields.`));
            return;
          }
          
          let correctIndex;
          const correctAnswerStr = String(correctAnswer).trim().toUpperCase();
          
          if (['1', '2', '3', '4'].includes(correctAnswerStr)) {
            correctIndex = parseInt(correctAnswerStr) - 1;
          } else if (['A', 'B', 'C', 'D'].includes(correctAnswerStr)) {
            correctIndex = correctAnswerStr.charCodeAt(0) - 'A'.charCodeAt(0);
          } else {
            console.error(`Invalid correctAnswer value: "${correctAnswer}", normalized: "${correctAnswerStr}"`);
            reject(new Error(`Invalid correct answer at row ${rowCount}. Must be 1-4 or A-D. Got: "${correctAnswer}"`));
            return;
          }
          
          if (correctIndex < 0 || correctIndex > 3) {
            reject(new Error(`Invalid correct answer at row ${rowCount}. Must be 1-4 or A-D. Got: "${correctAnswer}"`));
            return;
          }

          questions.push({
            question: question.trim(),
            options: [optionA.trim(), optionB.trim(), optionC.trim(), optionD.trim()],
            correctIndex: correctIndex
          });
        })
        .on('end', async () => {
          try {
            // Delete uploaded file
            fs.unlinkSync(req.file.path);

            if (questions.length !== 50) {
              resolve(res.status(400).json({ 
                message: `CSV must contain exactly 50 questions. Found: ${questions.length}` 
              }));
              return;
            }

            // Delete existing quiz if it's not currently LIVE
            const existingQuiz = await Quiz.findOne({ quizDate: today });
            if (existingQuiz && existingQuiz.state === 'LIVE') {
              resolve(res.status(400).json({ message: 'Cannot modify quiz while it is live' }));
              return;
            }
            if (existingQuiz && ['DRAFT', 'CREATED', 'CLOSED', 'ENDED', 'FINALIZED', 'RESULT_PUBLISHED'].includes(existingQuiz.state)) {
              await Quiz.deleteOne({ _id: existingQuiz._id });
            }

            // Create quiz
            const quiz = await Quiz.create({
              quizDate: today,
              questions: questions,
              state: 'LOCKED', // Create in LOCKED state to prevent auto-start
              tier: 'BRONZE',
              minStreakRequired: 0,
              subscriptionRequired: 'FREE',
              classGrade: req.body.classGrade || 'ALL' // Default to ALL classes if not specified
            });

            await logAdminAction(req.user._id, 'QUIZ_CREATED_CSV', 'QUIZ', quiz.quizDate, { questionsCount: quiz.questions.length, source: 'CSV' }, req);
            resolve(res.json({ message: 'Quiz created successfully from CSV', quiz }));
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  } catch (error) {
    console.error('CSV upload error:', error);
    res.status(500).json({ message: error.message || 'Failed to process CSV file' });
  }
});

router.get("/quiz/status", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await Quiz.findOne({ quizDate: today });
    if (quiz) {
      // Populate questions for display
      await quiz.populate('questions');
      res.json(quiz);
    } else {
      res.json({ quizDate: today, state: null });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/quiz/:quizDate/lock", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const quiz = await QuizService.lockQuiz(req.params.quizDate);
    await logAdminAction(req.user._id, 'QUIZ_LOCKED', 'QUIZ', req.params.quizDate, { status: 'LOCKED' }, req);
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/quiz/:quizDate/start", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const quiz = await QuizService.startQuiz(req.params.quizDate);
    await logAdminAction(req.user._id, 'QUIZ_STARTED', 'QUIZ', req.params.quizDate, { status: 'LIVE' }, req);
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/quiz/:quizDate/end", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const quiz = await QuizService.endQuiz(req.params.quizDate);
    await logAdminAction(req.user._id, 'QUIZ_ENDED', 'QUIZ', req.params.quizDate, { status: 'CLOSED' }, req);
    res.json(quiz);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/quiz/:quizDate/force-finalize", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only SUPER_ADMIN can force finalize' });
    }
    const winners = await QuizService.calculateAndPersistWinners(req.params.quizDate, {
      disasterMode: true,
      adminId: req.user._id
    });
    await logAdminAction(req.user._id, 'FORCE_FINALIZE', 'QUIZ', req.params.quizDate, { winnerCount: winners.length }, req);
    res.json({ success: true, winnerCount: winners.length });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete quiz endpoint - allows admins to delete old/ended quizzes
router.delete("/quiz/:quizDate", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const quiz = await Quiz.findOne({ quizDate: req.params.quizDate });
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    if (quiz.state === 'LIVE') {
      return res.status(400).json({ message: 'Cannot delete quiz while it is live' });
    }
    await Quiz.deleteOne({ _id: quiz._id });
    await logAdminAction(req.user._id, 'QUIZ_DELETED', 'QUIZ', req.params.quizDate, { state: quiz.state }, req);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Blog approval (CONTENT_ADMIN or SUPER_ADMIN)
router.get("/blogs/pending", roleRequired(["CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    console.log('🔍 Admin blogs/pending endpoint called');
    console.log('🔍 User:', req.user ? { id: req.user._id, role: req.user.role, name: req.user.name } : 'No user');
    
    const blogs = await BlogService.getPendingBlogs();
    console.log('🔍 Found pending blogs:', blogs.length);
    
    res.json(blogs);
  } catch (error) {
    console.error('❌ Error in blogs/pending:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put("/blogs/:blogId/approve", roleRequired(["CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const blog = await BlogService.updateBlogStatus(req.params.blogId, "APPROVED", req.user._id);
    res.json(blog);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/blogs/:blogId/reject", roleRequired(["CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const blog = await BlogService.updateBlogStatus(req.params.blogId, "REJECTED", req.user._id);
    res.json(blog);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/users/:userId/block", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isBlocked = true;
    await user.save();

    await logAdminAction(req.user._id, 'USER_BLOCKED', 'USER', user._id, { reason: req.body.reason }, req);
    res.json({ success: true, message: 'User blocked successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/users/:userId/unblock", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isBlocked = false;
    await user.save();

    await logAdminAction(req.user._id, 'USER_UNBLOCKED', 'USER', user._id, {}, req);
    res.json({ success: true, message: 'User unblocked successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/users/:userId", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Soft delete - mark as blocked and anonymize
    user.isBlocked = true;
    user.name = 'Deleted User';
    user.phone = null;
    user.email = null;
    await user.save();

    await logAdminAction(req.user._id, 'USER_DELETED', 'USER', user._id, {}, req);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Payments (SUPER_ADMIN only)
router.get("/payments", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const payments = await Payment.find().populate('user', 'name phone');
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Refunds (SUPER_ADMIN) - list and process
router.get('/refunds', roleRequired(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { getAllRefunds } = await import('../payment/payment.service.js');
    const refunds = await getAllRefunds();
    res.json(refunds);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/refunds/:refundId/process', roleRequired(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { adminProcessRefund } = await import('../payment/payment.service.js');
    const result = await adminProcessRefund(req.params.refundId, req.user._id);
    await logAdminAction(req.user._id, 'REFUND_PROCESS_REQUESTED', 'REFUND', req.params.refundId, { result }, req);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/refunds/:refundId/status', roleRequired(['SUPER_ADMIN']), async (req, res) => {
  try {
    const Refund = (await import('../payment/refund.model.js')).default;
    const refund = await Refund.findById(req.params.refundId);
    if (!refund) return res.status(404).json({ message: 'Refund not found' });

    const { status } = req.body;
    if (!['REQUESTED','PROCESSING','COMPLETED','FAILED'].includes(status)) return res.status(400).json({ message: 'Invalid status' });

    refund.status = status;
    await refund.save();
    if (status === 'COMPLETED' && refund.payment) {
      await Payment.updateOne({ _id: refund.payment }, { $set: { status: 'REFUNDED' } });
    }
    await logAdminAction(req.user._id, 'REFUND_STATUS_UPDATED', 'REFUND', refund._id, { status }, req);
    res.json({ success: true, refund });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Winners (QUIZ_ADMIN or SUPER_ADMIN)
router.get("/winners", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { date } = req.query;
    const quizDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const winners = await Winner.find({ quizDate })
      .populate('user', 'name phone email profileImage fullName username')
      .sort({ rank: 1 })
      .limit(20);
    
    // Get total participants
    const totalParticipants = await QuizAttempt.countDocuments({ quizDate, answersSaved: true });
    
    // Ensure user object always present and provide default profileImage to avoid frontend null errors
    const transformedWinners = winners.map(w => {
      const userObj = w.user || {};
      const displayName = userObj.name || userObj.fullName || userObj.username || 'Unknown';
      const profileImage = userObj.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;
      return {
        _id: w._id,
        rank: w.rank,
        score: w.score,
        totalTimeMs: w.totalTimeMs,
        accuracy: w.score > 0 ? ((w.score / 50) * 100).toFixed(2) : 0,
        user: {
          _id: userObj._id || null,
          name: displayName,
          phone: userObj.phone || null,
          email: userObj.email || null,
          profileImage
        },
        quizDate: w.quizDate
      };
    });

    res.json({
      winners: transformedWinners,
      quizDate,
      totalParticipants
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin Audit Logs (SUPER_ADMIN only)
router.get("/audit", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const { adminId, action, limit = 100 } = req.query;
    const logs = await getAdminAuditLog(adminId, action, parseInt(limit));
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/audit/trail/:targetType/:targetId", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const trail = await getAuditTrail(targetType, targetId);
    res.json(trail);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Dashboard statistics
router.get("/dashboard", authRequired, roleRequired(["QUIZ_ADMIN", "CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const [totalUsers, eligibleUsers, pendingBlogs, todaysPayments] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isEligible: true }),
      BlogService.getPendingBlogsCount(),
      Payment.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(today + 'T00:00:00.000Z'),
              $lt: new Date(today + 'T23:59:59.999Z')
            },
            status: 'SUCCESS'
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    res.json({
      totalUsers,
      eligibleUsers,
      pendingBlogs,
      todaysPayments: todaysPayments[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all users
router.get("/users", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  console.log('\n\n🚨🚨🚨 /admin/users endpoint HIT! 🚨🚨🚨\n\n');
  try {
    // Disable all caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    
    console.log('📍 Starting user fetch from database');
    
    // Get all users including admins
    const totalUsers = await User.countDocuments({});
    console.log(`📊 Total users in database: ${totalUsers}`);
    
    const users = await User.find({})
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    console.log(`📊 Found ${users.length} users in current page`);
    
    // Add classGrade field to each user
    const usersData = users.map(user => {
      let classGrade = 'N/A';
      
      // Log raw class value and type
      console.log(`\n👤 Processing: ${user.name || 'Unknown'}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   class value: "${user.class}", type: ${typeof user.class}`);
      
      // Determine classGrade based on class value
      if (user.class === '10') {
        classGrade = '10th';
        console.log(`   ✅ Matched class === '10'`);
      } else if (user.class === '12') {
        classGrade = '12th';
        console.log(`   ✅ Matched class === '12'`);
      } else if (user.class === 'Other') {
        classGrade = 'Other';
        console.log(`   ✅ Matched class === 'Other'`);
      } else {
        console.log(`   ❌ No match, setting to N/A`);
      }
      
      console.log(`   📌 Final classGrade: ${classGrade}`);
      
      return {
        ...user,
        classGrade: classGrade,
        profileImage: user.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}`
      };
    });
    
    console.log(`\n✅ All ${usersData.length} users processed successfully`);
    console.log(`📤 Sending response with ${usersData.length} users`);
    
    res.json({ 
      users: usersData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalUsers,
        pages: Math.ceil(totalUsers / limit)
      }
    });
  } catch (error) {
    console.error('❌ ERROR in /admin/users:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get pending blogs for approval
router.get("/blogs/pending", roleRequired(["CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const blogs = await BlogService.getPendingBlogs();
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Approve blog
router.post("/blogs/:blogId/approve", roleRequired(["CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const blog = await BlogService.approveBlog(req.params.blogId);
    await logAdminAction(req.user._id, 'BLOG_APPROVED', 'BLOG', req.params.blogId, { title: blog.title }, req);
    res.json({ message: 'Blog approved successfully', blog });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Reject blog
router.post("/blogs/:blogId/reject", roleRequired(["CONTENT_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const blog = await BlogService.rejectBlog(req.params.blogId);
    await logAdminAction(req.user._id, 'BLOG_REJECTED', 'BLOG', req.params.blogId, { title: blog.title }, req);
    res.json({ message: 'Blog rejected successfully', blog });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get all payments (SUPER_ADMIN)
router.get("/payments", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const { page = 1, limit = 50, status, quizDate } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (quizDate) query.quizDate = quizDate;
    
    const payments = await Payment.find(query)
      .populate('user', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Payment.countDocuments(query);
    
    res.json({
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get today's payments
router.get("/payments/today", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const payments = await Payment.find({
      quizDate: today
    }).populate('user', 'name phone email').sort({ createdAt: -1 });
    
    res.json({ payments });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// System health check for testing and monitoring
router.get("/system/health", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'checking',
      components: {},
      metrics: {}
    };

    // Database health
    try {
      const dbStats = await mongoose.connection.db.stats();
      health.components.database = {
        status: 'healthy',
        collections: dbStats.collections,
        dataSize: dbStats.dataSize
      };
    } catch (error) {
      health.components.database = { status: 'unhealthy', error: error.message };
    }

    // Redis health
    try {
      const redisClient = (await import('../../config/redis.js')).default;
      await redisClient.ping();
      health.components.redis = { status: 'healthy' };
    } catch (error) {
      health.components.redis = { status: 'unhealthy', error: error.message };
    }

    // Current quiz status
    try {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const quiz = await Quiz.findOne({ quizDate: today });
      health.components.quiz = {
        status: 'healthy',
        currentQuiz: quiz ? {
          date: quiz.quizDate,
          state: quiz.state,
          questions: quiz.questions.length
        } : null
      };
    } catch (error) {
      health.components.quiz = { status: 'unhealthy', error: error.message };
    }

    // Rate limiting status
    try {
      const redisClient = (await import('../../config/redis.js')).default;
      const keys = await redisClient.keys('rate_limit:*');
      health.metrics.rateLimitKeys = keys.length;
      health.components.rateLimiting = { status: 'healthy', activeKeys: keys.length };
    } catch (error) {
      health.components.rateLimiting = { status: 'unhealthy', error: error.message };
    }

    // Overall status
    const allHealthy = Object.values(health.components).every(comp => comp.status === 'healthy');
    health.status = allHealthy ? 'healthy' : 'degraded';

    res.json(health);
  } catch (error) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'error',
      error: error.message
    });
  }
});

// Quiz performance monitoring for testing
router.get("/system/quiz-performance", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const quiz = await Quiz.findOne({ quizDate: today });

    if (!quiz) {
      return res.json({
        timestamp: new Date().toISOString(),
        message: "No quiz found for today",
        performance: null
      });
    }

    // Get quiz attempts and performance metrics
    const attempts = await QuizAttempt.find({ quizId: quiz._id });
    const totalAttempts = attempts.length;
    const completedAttempts = attempts.filter(a => a.completed).length;

    // Calculate question-wise performance
    const questionStats = quiz.questions.map((question, index) => {
      const questionAttempts = attempts.filter(a => a.answers && a.answers[index]);
      const correctAnswers = questionAttempts.filter(a => a.answers[index].selectedOption === question.correctOption).length;
      const totalAnswers = questionAttempts.length;

      return {
        questionNumber: index + 1,
        totalAnswers,
        correctAnswers,
        accuracy: totalAnswers > 0 ? (correctAnswers / totalAnswers * 100).toFixed(1) : 0
      };
    });

    // Get active users count
    const activeUsers = await User.countDocuments({
      lastActive: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    // Get payment metrics
    const paidUsers = await User.countDocuments({ subscriptionStatus: 'active' });
    const totalUsers = await User.countDocuments();

    const performance = {
      quizDate: quiz.quizDate,
      quizState: quiz.state,
      totalQuestions: quiz.questions.length,
      currentQuestion: quiz.currentQuestionIndex + 1,
      totalAttempts,
      completedAttempts,
      completionRate: totalAttempts > 0 ? (completedAttempts / totalAttempts * 100).toFixed(1) : 0,
      questionStats,
      userMetrics: {
        totalUsers,
        activeUsers,
        paidUsers,
        paidUserPercentage: totalUsers > 0 ? (paidUsers / totalUsers * 100).toFixed(1) : 0
      },
      timestamp: new Date().toISOString()
    };

    res.json(performance);
  } catch (error) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Rate limiting monitoring for testing
router.get("/system/rate-limits", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const redisClient = (await import('../../config/redis.js')).default;

    // Get all rate limit keys
    const keys = await redisClient.keys('rate_limit:*');
    const rateLimitData = [];

    for (const key of keys.slice(0, 50)) { // Limit to first 50 for performance
      try {
        const value = await redisClient.get(key);
        const ttl = await redisClient.ttl(key);

        // Parse key to get user and endpoint info
        const keyParts = key.split(':');
        if (keyParts.length >= 3) {
          rateLimitData.push({
            userId: keyParts[2],
            endpoint: keyParts[3] || 'unknown',
            remaining: parseInt(value) || 0,
            ttl: ttl,
            expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null
          });
        }
      } catch (error) {
        // Skip problematic keys
        continue;
      }
    }

    // Group by endpoint for summary
    const endpointSummary = {};
    rateLimitData.forEach(item => {
      if (!endpointSummary[item.endpoint]) {
        endpointSummary[item.endpoint] = { count: 0, lowRemaining: 0 };
      }
      endpointSummary[item.endpoint].count++;
      if (item.remaining < 5) {
        endpointSummary[item.endpoint].lowRemaining++;
      }
    });

    res.json({
      timestamp: new Date().toISOString(),
      totalKeys: keys.length,
      sampledData: rateLimitData,
      endpointSummary,
      limits: {
        quizJoinAttempts: '20 per hour',
        answerSubmissions: '1 per 15 seconds',
        quizListRequests: '200 per minute'
      }
    });
  } catch (error) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Advanced Analytics (QUIZ_ADMIN or SUPER_ADMIN)
router.get("/analytics/overview", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = parseInt(period.replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ lastLoginAt: { $gte: startDate } });
    const newUsers = await User.countDocuments({ createdAt: { $gte: startDate } });

    // Payment statistics
    const totalPayments = await Payment.countDocuments({ status: 'SUCCESS' });
    const periodPayments = await Payment.countDocuments({
      status: 'SUCCESS',
      createdAt: { $gte: startDate }
    });
    const totalRevenue = await Payment.aggregate([
      { $match: { status: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    // Quiz statistics
    const totalQuizzes = await Quiz.countDocuments();
    const completedQuizzes = await Quiz.countDocuments({ status: 'FINALIZED' });
    const totalWinners = await Winner.countDocuments();

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        new: newUsers
      },
      payments: {
        total: totalPayments,
        period: periodPayments,
        revenue: totalRevenue[0]?.total || 0
      },
      quizzes: {
        total: totalQuizzes,
        completed: completedQuizzes,
        winners: totalWinners
      },
      period: `${days} days`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/analytics/revenue", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = parseInt(period.replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const revenueData = await Payment.aggregate([
      {
        $match: {
          status: 'SUCCESS',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          revenue: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json(revenueData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/analytics/user-engagement", roleRequired(["QUIZ_ADMIN", "SUPER_ADMIN"]), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = parseInt(period.replace('d', '')) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Daily active users
    const dailyActive = await User.aggregate([
      { $match: { lastLoginAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$lastLoginAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Quiz participation
    const quizParticipation = await QuizAttempt.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          participants: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      dailyActive,
      quizParticipation
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// User feedback collection (no auth required for submission)
router.post("/feedback", async (req, res) => {
  try {
    const feedback = req.body;

    // Store feedback in database (you can create a Feedback model)
    // For now, we'll log it and return success
    console.log('User Feedback Received:', {
      timestamp: new Date(),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      ...feedback
    });

    // TODO: Create Feedback model and store in database
    // const feedbackDoc = new Feedback(feedback);
    // await feedbackDoc.save();

    res.json({
      message: 'Feedback received successfully',
      feedbackId: Date.now() // Temporary ID
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Anti-cheat monitoring (SUPER_ADMIN only)
router.get("/anticheat/events/:quizDate?", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const ObservabilityService = (await import('../monitoring/observability.service.js')).default;
    const quizDate = req.params.quizDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const events = await ObservabilityService.getAntiCheatEvents(quizDate);
    
    res.json({
      quizDate,
      events,
      totalEvents: events.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/anticheat/user/:userId", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const ObservabilityService = (await import('../monitoring/observability.service.js')).default;
    const userId = req.params.userId;
    
    const events = await ObservabilityService.getUserAntiCheatEvents(userId);
    const suspiciousCheck = await ObservabilityService.detectSuspiciousActivity(userId);
    
    // Get user details
    const user = await User.findById(userId).select('name phone email username');
    
    res.json({
      user,
      events,
      suspiciousActivity: suspiciousCheck
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/anticheat/suspicious-users", roleRequired(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const ObservabilityService = (await import('../monitoring/observability.service.js')).default;
    
    // Get all users who have anti-cheat events in the last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // This is a simplified approach - in production you'd want more sophisticated detection
    const suspiciousUsers = [];
    
    // Get recent quiz attempts and check each user
    const recentAttempts = await QuizAttempt.find({
      createdAt: { $gte: yesterday }
    }).select('user').distinct('user');
    
    for (const userId of recentAttempts) {
      const check = await ObservabilityService.detectSuspiciousActivity(userId);
      if (check.isSuspicious) {
        const user = await User.findById(userId).select('name phone email username');
        suspiciousUsers.push({
          user,
          patterns: check.patterns
        });
      }
    }
    
    res.json({
      suspiciousUsers,
      totalSuspicious: suspiciousUsers.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
