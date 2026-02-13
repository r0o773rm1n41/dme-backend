// modules/admin/adminAuth.routes.js
import express from "express";
import * as AuthController from "../auth/auth.controller.js";
import { authRequired } from "../../middlewares/auth.middleware.js";
import { authRateLimit } from "../../middlewares/rate-limit.middleware.js";

const router = express.Router();

// Admin login
router.post("/login", authRateLimit, AuthController.adminLogin);

// Admin forgot password
router.post("/forgot-password", authRateLimit, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // Use the same password reset logic as regular users
    await AuthController.requestPasswordReset(req, res);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin reset password
router.post("/reset-password", authRateLimit, async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;
    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ message: "Phone, OTP, and new password are required" });
    }

    // Verify admin role before allowing password reset
    const User = (await import("../user/user.model.js")).default;
    const user = await User.findOne({ 
      phone, 
      role: { $in: ["ADMIN", "SUPER_ADMIN", "QUIZ_ADMIN", "CONTENT_ADMIN"] }
    });
    
    if (!user) {
      return res.status(404).json({ message: "Admin user not found" });
    }

    // Use the same password reset logic as regular users
    await AuthController.resetPassword(req, res);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get admin profile (check if admin is authenticated)
router.get("/profile", authRequired, async (req, res) => {
  try {
    console.log('🔍 Admin profile endpoint called');
    console.log('🔍 User:', req.user ? { id: req.user._id, role: req.user.role, name: req.user.name } : 'No user');
    
    // Check if user has admin role
    if (!['QUIZ_ADMIN', 'CONTENT_ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      console.log('❌ User does not have admin role:', req.user.role);
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    // Return admin user data
    const User = (await import("../user/user.model.js")).default;
    const admin = await User.findById(req.user._id).select('-passwordHash');
    
    console.log('✅ Admin profile found:', { id: admin._id, role: admin.role, name: admin.name });
    
    res.json({
      _id: admin._id,
      name: admin.name,
      fullName: admin.fullName,
      username: admin.username,
      phone: admin.phone,
      email: admin.email,
      role: admin.role,
      profileImage: admin.profileImage
    });
  } catch (error) {
    console.error('❌ Get admin profile error:', error);
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// Admin logout
router.post("/logout", authRequired, (req, res) => {
  // Client-side logout (token removed from localStorage)
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
