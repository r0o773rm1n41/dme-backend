// modules/reports/report.routes.js
import express from 'express';
import * as ReportService from './report.service.js';
import { authRequired, roleRequired } from '../../middlewares/auth.middleware.js';
import { reportRateLimit } from '../../middlewares/rate-limit.middleware.js';

const router = express.Router();

// Report a user/blog
router.post('/user', authRequired, reportRateLimit, async (req, res) => {
  try {
    const { blogId, reportedUserId, reason, description } = req.body;

    if (!blogId || !reportedUserId || !reason) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const report = await ReportService.createReport(req.user._id, {
      blogId,
      reportedUserId,
      reason,
      description
    });

    res.json({ message: 'Report submitted successfully', report });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Check if user is blocked
router.get('/check/:userId', authRequired, async (req, res) => {
  try {
    const result = await ReportService.checkBlockStatus(req.user._id, req.params.userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Block a user
router.post('/block', authRequired, reportRateLimit, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const block = await ReportService.blockUser(req.user._id, userId);
    res.json({ message: 'User blocked successfully', block });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Unblock a user
router.post('/unblock', authRequired, reportRateLimit, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const result = await ReportService.unblockUser(req.user._id, userId);
    res.json({ message: 'User unblocked successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin routes
router.get('/admin/pending', authRequired, roleRequired(['SUPER_ADMIN']), async (req, res) => {
  try {
    const reports = await ReportService.getUserReports(null, 'pending');
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/admin/:reportId', authRequired, roleRequired(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { status } = req.body;
    const report = await ReportService.updateReportStatus(req.params.reportId, status, req.user._id);
    res.json(report);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;