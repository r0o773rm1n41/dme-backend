// modules/blog/blog.service.js
import Blog from "./blog.model.js";
import BlogLike from "./blogLike.model.js";
import User from "../user/user.model.js";
import cloudinary from "../../config/cloudinary.js";
import redisClient from "../../config/redis.js";
import { logAdminAction } from "../admin/adminAudit.service.js";

export function generateSignedPdfUrl(publicId, expirationMinutes = 60) {
  if (!publicId) return null;
  
  // Extract public_id if a full URL is passed
  let id = publicId;
  if (publicId.includes('/upload/')) {
    // Extract public_id from Cloudinary URL
    const parts = publicId.split('/upload/');
    if (parts.length > 1) {
      const pathParts = parts[1].split('/');
      id = pathParts.slice(1).join('/').replace(/\.[^/.]+$/, ''); // Remove version and extension
    }
  }
  
  // Generate signed URL with expiration
  const expiration = Math.floor(Date.now() / 1000) + (expirationMinutes * 60);
  return cloudinary.utils.private_download_url(id, 'pdf', {
    expires_at: expiration,
    resource_type: 'raw'
  });
}

export async function createBlog(userId, { title, content, pdf }) {
  let pdfPublicId = null;
  let pdfSize = null;
  if (pdf) {
    if (typeof pdf === 'string') {
      // PDF is already a Cloudinary URL
      pdfPublicId = pdf;
      pdfSize = 0; // Size unknown for pre-uploaded files
    } else {
      // PDF is a file object, upload to Cloudinary
      // Validate file size (10MB max)
      if (pdf.size > 10 * 1024 * 1024) {
        const fs = await import('fs');
        if (pdf.path) {
          try {
            fs.unlinkSync(pdf.path);
          } catch (e) {
            console.error('Failed to delete file:', e);
          }
        }
        throw new Error('PDF size cannot exceed 10MB');
      }

      try {
        // Upload to Cloudinary with performance optimizations
        const result = await cloudinary.uploader.upload(pdf.path, {
          folder: "blogs",
          resource_type: "raw",
          allowed_formats: ["pdf"],
          max_file_size: 10 * 1024 * 1024, // 10MB
          // Performance optimizations
          quality: "auto", // Auto quality optimization
          fetch_format: "auto", // Auto format conversion
          flags: "attachment", // Force download for PDFs
          // Reduce upload time
          chunk_size: 6000000, // 6MB chunks for faster upload
          timeout: 60000 // 60 second timeout
        });
        pdfPublicId = result.public_id;
        pdfSize = result.bytes;
      } catch (error) {
        console.error('Cloudinary upload error:', error);
        // Clean up file on error
        const fs = await import('fs');
        if (pdf.path) {
          try {
            fs.unlinkSync(pdf.path);
          } catch (e) {
            console.error('Failed to delete file:', e);
          }
        }
        throw new Error(`PDF upload failed: ${error.message}`);
      }
    }
  }

  const blog = new Blog({
    author: userId,
    title,
    content,
    pdfUrl: pdfPublicId,
    pdfSize,
    status: "PENDING"
  });

  await blog.save();
  return blog;
}

export async function getApprovedBlogs(limit = 20, skip = 0) {
  const cacheKey = `blogs:approved:${limit}:${skip}`;

  // Try cache first
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn('Redis cache read failed:', error.message);
  }

  // Fetch from database
  const blogs = await Blog.find({ status: "APPROVED" })
    .populate("author", "name fullName username profileImage phone email")
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);

  // Cache for 5 minutes
  try {
    await redisClient.setEx(cacheKey, 300, JSON.stringify(blogs));
  } catch (error) {
    console.warn('Redis cache write failed:', error.message);
  }

  return blogs;
}

export async function getApprovedBlogsCount() {
  return await Blog.countDocuments({ status: "APPROVED" });
}

export async function getAllApprovedBlogs() {
  // Fetch all approved blogs without pagination
  const blogs = await Blog.find({ status: "APPROVED" })
    .populate("author", "name fullName username profileImage phone email")
    .sort({ createdAt: -1 });

  return blogs;
}

export async function getBlogById(blogId, userId = null, isAdmin = false, isEligible = false) {
  // Enforce admin approval at DB query level for non-admin users
  const query = isAdmin ? { _id: blogId } : { _id: blogId, status: "APPROVED" };
  const blog = await Blog.findOne(query).populate("author", "name fullName username profileImage phone email");
  if (!blog) throw new Error("Blog not found");

  // Check visibility restrictions for non-admin users
  if (!isAdmin && blog.visibility === "PAID_ONLY" && !isEligible) {
    throw new Error("This blog requires payment to view. Please complete your quiz payment to access premium content.");
  }

  // Increment views with throttling (once per user per blog per 24 hours)
  if (blog.author && userId && blog.author._id.toString() !== userId) {
    const viewKey = `view:${userId}:${blogId}`;
    let hasViewed = false;
    if (typeof redisClient.exists === 'function') {
      hasViewed = await redisClient.exists(viewKey);
    } else {
      // fallback: treat as not viewed
      hasViewed = false;
    }
    if (!hasViewed) {
      blog.viewsCount += 1;
      await blog.save();
      if (typeof redisClient.setEx === 'function') {
        await redisClient.setEx(viewKey, 86400, '1');
      } else if (typeof redisClient.set === 'function') {
        await redisClient.set(viewKey, '1');
      }
    }
  }

  // Generate signed URL for PDF if exists
  if (blog.pdfUrl) {
    // blog.pdfUrl now contains the Cloudinary public_id
    blog._doc.signedPdfUrl = generateSignedPdfUrl(blog.pdfUrl, 60); // 1 hour expiration
  }

  // Check if user has liked this blog
  if (userId) {
    const userLike = await BlogLike.findOne({ user: userId, blog: blogId });
    blog._doc.liked = !!userLike;
  } else {
    blog._doc.liked = false;
  }

  return blog;
}

export async function likeBlog(blogId, userId, isEligible = false) {
  // Enforce admin approval and visibility at DB query level
  const visibilityQuery = isEligible ? {} : { visibility: { $ne: "PAID_ONLY" } };
  const blog = await Blog.findOne({
    _id: blogId,
    status: "APPROVED",
    ...visibilityQuery
  });
  if (!blog) throw new Error("Blog not found or access denied");

  // Check if user already liked this blog
  const existingLike = await BlogLike.findOne({ user: userId, blog: blogId });

  if (existingLike) {
    // Unlike: remove the like
    await BlogLike.deleteOne({ _id: existingLike._id });
    blog.likesCount = Math.max(0, blog.likesCount - 1);
    await blog.save();
    return { liked: false, likesCount: blog.likesCount };
  } else {
    // Like: add new like
    const newLike = new BlogLike({ user: userId, blog: blogId });
    await newLike.save();
    blog.likesCount += 1;
    await blog.save();
    return { liked: true, likesCount: blog.likesCount };
  }
}

export async function trackBlogView(blogId, userId) {
  const blog = await Blog.findById(blogId);
  if (!blog) throw new Error("Blog not found");

  // Increment view count
  blog.viewsCount = (blog.viewsCount || 0) + 1;

  await blog.save();

  return { 
    viewsCount: blog.viewsCount
  };
}

export async function updateBlogStatus(blogId, status, adminId) {
  const blog = await Blog.findById(blogId);
  if (!blog) throw new Error("Blog not found");

  const oldStatus = blog.status;
  blog.status = status;
  await blog.save();

  // Audit logging for admin actions
  auditLog('UPDATE_BLOG_STATUS', adminId, {
    blogId,
    oldStatus,
    newStatus: status,
    authorId: blog.author
  });

  return blog;
}

export async function getPendingBlogs() {
  return await Blog.find({ status: "PENDING" }).populate("author", "name fullName username profileImage phone email");
}

export async function deleteBlog(blogId, userId) {
  console.log('deleteBlog called with blogId:', blogId, 'userId:', userId);
  const blog = await Blog.findOne({ _id: blogId, author: userId });
  console.log('Found blog:', blog);
  if (!blog) throw new Error("Blog not found or not authorized");

  // Delete from Cloudinary if pdf
  if (blog.pdfUrl) {
    const filename = blog.pdfUrl.split('/').pop().split('.')[0];
    const publicId = `blogs/${filename}`;
    await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
  }

  await blog.deleteOne();
  return { success: true };
}

export async function getUserBlogs(userId, limit = null, skip = 0) {
  const query = Blog.find({ author: userId }).populate("author", "name fullName username profileImage phone email").sort({ createdAt: -1 });
  if (limit) {
    query.limit(limit).skip(skip);
  }
  return await query;
}

export async function getUserBlogsCount(userId) {
  return await Blog.countDocuments({ author: userId });
}

export async function getUserById(userId) {
  return await User.findById(userId).select('-passwordHash');
}

export async function getPendingBlogsCount() {
  return await Blog.countDocuments({ status: "PENDING" });
}

export async function approveBlog(blogId) {
  const blog = await Blog.findById(blogId);
  if (!blog) throw new Error("Blog not found");

  blog.status = "APPROVED";
  await blog.save();
  return blog;
}

export async function rejectBlog(blogId) {
  const blog = await Blog.findById(blogId);
  if (!blog) throw new Error("Blog not found");

  blog.status = "REJECTED";
  await blog.save();
  return blog;
}