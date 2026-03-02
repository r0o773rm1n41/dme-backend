// modules/reports/report.service.js
import Report from './report.model.js';
import Block from './block.model.js';

export async function createReport(reporterId, { blogId, reportedUserId, reason, description }) {
  // Check if user already reported this blog
  const existingReport = await Report.findOne({
    reporter: reporterId,
    blog: blogId,
    status: 'pending'
  });

  if (existingReport) {
    throw new Error('You have already reported this blog');
  }

  const report = new Report({
    reporter: reporterId,
    reportedUser: reportedUserId,
    blog: blogId,
    reason,
    description
  });

  await report.save();
  return report;
}

export async function checkBlockStatus(blockerId, blockedId) {
  const block = await Block.findOne({
    blocker: blockerId,
    blocked: blockedId
  });

  return {
    blockedByMe: !!block
  };
}

export async function blockUser(blockerId, blockedId) {
  // Prevent self-blocking
  if (blockerId === blockedId) {
    throw new Error('Cannot block yourself');
  }

  // Check if already blocked
  const existingBlock = await Block.findOne({
    blocker: blockerId,
    blocked: blockedId
  });

  if (existingBlock) {
    throw new Error('User already blocked');
  }

  const block = new Block({
    blocker: blockerId,
    blocked: blockedId
  });

  await block.save();
  return block;
}

export async function unblockUser(blockerId, blockedId) {
  const result = await Block.findOneAndDelete({
    blocker: blockerId,
    blocked: blockedId
  });

  if (!result) {
    throw new Error('Block not found');
  }

  return result;
}

export async function getUserReports(userId, status = 'pending') {
  const query = { status };
  if (userId) {
    query.reportedUser = userId;
  }
  return await Report.find(query)
    .populate('reporter', 'fullName username')
    .populate('reportedUser', 'fullName username')
    .populate('blog', 'title')
    .sort({ createdAt: -1 });
}

export async function updateReportStatus(reportId, status, adminId) {
  const report = await Report.findByIdAndUpdate(
    reportId,
    { status },
    { new: true }
  ).populate('reporter', 'name').populate('reportedUser', 'name').populate('blog', 'title');

  if (!report) {
    throw new Error('Report not found');
  }

  return report;
}