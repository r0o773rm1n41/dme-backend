// modules/blog/blog.routes.js
import express from "express";
import multer from "multer";
import * as BlogService from "./blog.service.js";
import { authRequired, roleRequired, eligibilityRequired } from "../../middlewares/auth.middleware.js";
import { blogListRateLimit, blogViewRateLimit, fileUploadRateLimit, writeRateLimit } from "../../middlewares/rate-limit.middleware.js";
import cloudinary from "../../config/cloudinary.js";
import fetch from 'node-fetch';
import { validate, blogSchemas } from "../../utils/validation.js";
import QuizAttempt from "../quiz/quizAttempt.model.js"; // add at top

const router = express.Router();

// Configure multer for PDF upload to memory
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for PDFs
});

// Create blog
router.post("/", authRequired, writeRateLimit, upload.single("pdf"), validate(blogSchemas.createBlog), async (req, res) => {
  try {
    let pdfUrl = null;

    // Handle PDF upload to Cloudinary
    if (req.file) {
      const { checkAndConsumePdfUpload } = await import("../payment/pdfAccess.service.js");
      const access = await checkAndConsumePdfUpload(req.user._id);

      if (!access.allowed) {
        return res.status(403).json({
          message: "PDF upload locked. Make a quiz payment once to unlock lifetime access."
        });
      }

      // Upload PDF to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'blog-pdfs',
            public_id: `blog_${req.user._id}_${Date.now()}`,
            resource_type: 'raw' // For non-image files like PDFs
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });
      pdfUrl = result.public_id;  // Store public_id instead of secure_url
    }

    const blog = await BlogService.createBlog(req.user._id, {
      title: req.body.title,
      content: req.body.content,
      pdf: pdfUrl // Pass the Cloudinary URL instead of file object
    });
    res.json(blog);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get approved blogs (home feed)
router.get("/", blogListRateLimit, async (req, res) => {
  try {
    const getAll = req.query.getAll === 'true';

    if (getAll) {
      // Return all approved blogs without pagination
      const blogs = await BlogService.getAllApprovedBlogs();
      
      // Add 'liked' status for current user if authenticated
      const enrichedBlogs = blogs.map(blog => ({
        ...blog.toObject(),
        liked: req.user && blog.likes && blog.likes.some(likeId => likeId.toString() === req.user._id.toString())
      }));
      
      res.json({
        blogs: enrichedBlogs,
        pagination: {
          totalBlogs: enrichedBlogs.length,
          hasNext: false,
          hasPrev: false
        }
      });
    } else {
      // Paginated response
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const blogs = await BlogService.getApprovedBlogs(limit, skip);
      const totalBlogs = await BlogService.getApprovedBlogsCount();
      const totalPages = Math.ceil(totalBlogs / limit);

      // Add 'liked' status for current user if authenticated
      const enrichedBlogs = blogs.map(blog => ({
        ...blog.toObject(),
        liked: req.user && blog.likes && blog.likes.some(likeId => likeId.toString() === req.user._id.toString())
      }));

      res.json({
        blogs: enrichedBlogs,
        pagination: {
          currentPage: page,
          totalPages,
          totalBlogs,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get blog details (gated by eligibility)
router.get("/:blogId", authRequired, blogViewRateLimit, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN';
    const isEligible = req.user.isEligible || isAdmin;

    const blog = await BlogService.getBlogById(req.params.blogId, req.user._id, isAdmin, isEligible);
    res.json(blog);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Download PDF - ONLY paid users can download PDFs
router.get("/:blogId/pdf", authRequired, async (req, res) => {
  try {
    // Check if user has PDF access (lifetime or temporary credits)
    const { checkAndConsumePdfDownload } = await import("../payment/pdfAccess.service.js");
    const access = await checkAndConsumePdfDownload(req.user._id);

    if (!access.allowed) {
      return res.status(403).json({
        message: "PDF download locked. Make a quiz payment once to unlock lifetime access."
      });
    }

    const blog = await BlogService.getBlogById(req.params.blogId, req.user._id, req.user.role === 'ADMIN', true);
    if (!blog.pdfUrl) {
      return res.status(404).json({ message: "PDF not found" });
    }

    // Generate fresh signed URL with short expiration for download
    const signedUrl = BlogService.generateSignedPdfUrl(blog.pdfUrl, 15); // 15 minutes
    
    if (!signedUrl) {
      return res.status(404).json({ message: "PDF URL generation failed" });
    }
    
    // Use Cloudinary API to get resource metadata (includes secure_url)
    try {
      const resource = await cloudinary.api.resource(blog.pdfUrl, { resource_type: 'raw' });
      const downloadUrl = resource.secure_url || signedUrl;

      console.log('Using Cloudinary resource URL:', downloadUrl);

      const upstream = await fetch(downloadUrl);
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Cloudinary fetch failed:', upstream.status, text);
        return res.status(502).json({ message: 'Failed to fetch PDF from storage' });
      }

      const contentType = upstream.headers.get('content-type') || 'application/pdf';
      res.setHeader('Content-Type', contentType);

      // Build a safe filename from the stored public_id
      const rawName = (blog.pdfUrl || '').split('/').pop() || 'download';
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

      // Stream upstream body to client
      upstream.body.pipe(res);
      return;
    } catch (err) {
      console.error('Proxying PDF failed (resource or fetch):', err?.body || err?.message || err);
      return res.status(500).json({ message: 'Failed to proxy PDF' });
    }
  } catch (error) {
    console.error('PDF download error:', error);
    res.status(400).json({ message: error.message || "Failed to generate PDF URL" });
  }
});

// Like/unlike blog
router.post("/:blogId/like", authRequired, blogViewRateLimit, async (req, res) => {
  try {
    const isEligible = req.user.isEligible || req.user.role === 'ADMIN';
    const result = await BlogService.likeBlog(req.params.blogId, req.user._id, isEligible);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Track blog view
router.post("/:blogId/view", authRequired, blogViewRateLimit, async (req, res) => {
  try {
    const result = await BlogService.trackBlogView(req.params.blogId, req.user._id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get user's own blogs
router.get("/user/me", authRequired, blogListRateLimit, async (req, res) => {
  try {
    const blogs = await BlogService.getUserBlogs(req.user._id);
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// // Get blogs by user ID (public route for viewing other users' blogs)
// router.get("/user/:userId", async (req, res) => {
//   try {

//     // inside the route
// const quizzes = await QuizAttempt.find({ user: req.params.userId })
//   .sort({ createdAt: -1 })  // latest first
//   .select("_id quizDate score correctAnswers totalQuestions rank timeSpent")
//   .lean();


//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     // Check if user exists
//     const user = await BlogService.getUserById(req.params.userId);
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const blogs = await BlogService.getUserBlogs(req.params.userId, limit, skip);
//     const totalBlogs = await BlogService.getUserBlogsCount(req.params.userId);
//     const totalPages = Math.ceil(totalBlogs / limit);

//     // Add 'liked' status for current user if authenticated
//     const enrichedBlogs = blogs.map(blog => ({
//       ...blog.toObject(),
//       liked: req.user && blog.likes && blog.likes.some(likeId => likeId.toString() === req.user._id.toString())
//     }));

//     res.json({
//       blogs: enrichedBlogs,
//       user,
//       pagination: {
//         currentPage: page,
//         totalPages,
//         totalBlogs,
//         hasNext: page < totalPages,
//         hasPrev: page > 1
//       }
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// Get blogs by user ID (public route for viewing other users' blogs)
router.get("/user/:userId", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Check if user exists
    const user = await BlogService.getUserById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch user's quizzes
    const quizzes = await QuizAttempt.find({ user: req.params.userId })
      .sort({ createdAt: -1 })
      .select("_id quizDate score correctAnswers totalQuestions rank timeSpent")
      .lean();

    // Fetch user's blogs
    const blogs = await BlogService.getUserBlogs(req.params.userId, limit, skip);
    const totalBlogs = await BlogService.getUserBlogsCount(req.params.userId);
    const totalPages = Math.ceil(totalBlogs / limit);

    // Add 'liked' status for current user if authenticated
    const enrichedBlogs = blogs.map(blog => ({
      ...blog.toObject(),
      liked: req.user && blog.likes && blog.likes.some(likeId => likeId.toString() === req.user._id.toString())
    }));

    // Send blogs + quizzes together
    res.json({
      blogs: enrichedBlogs,
      quizzes,      // ✅ this is now included
      user,
      pagination: {
        currentPage: page,
        totalPages,
        totalBlogs,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete blog
router.delete("/:blogId", authRequired, async (req, res) => {
  try {
    console.log('Delete blog route called with blogId:', req.params.blogId, 'userId:', req.user._id);
    const result = await BlogService.deleteBlog(req.params.blogId, req.user._id);
    res.json(result);
  } catch (error) {
    console.log('Delete blog error:', error.message);
    res.status(400).json({ message: error.message });
  }
});

export default router;