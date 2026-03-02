// modules/auth/auth.routes.js
import express from "express";
import multer from "multer";
import * as AuthController from "./auth.controller.js";
import { authRequired } from "../../middlewares/auth.middleware.js";
import { authRateLimit, writeRateLimit } from "../../middlewares/rate-limit.middleware.js";
import { validate, authSchemas } from "../../utils/validation.js";

const router = express.Router();

// Configure multer for profile image upload
const upload = multer({
  storage: multer.memoryStorage(), // Store in memory for Cloudinary upload
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// OTP endpoints - strict rate limiting
router.post("/register/otp", authRateLimit, validate(authSchemas.registerOtp), AuthController.sendRegisterOtp);
router.post("/password/otp", authRateLimit, validate(authSchemas.verifyOtp), AuthController.sendResetOtp);

// Auth endpoints - auth rate limiting (5 attempts per 15 minutes)
router.post("/register", authRateLimit, validate(authSchemas.register), AuthController.register);
router.post("/login", authRateLimit, validate(authSchemas.login), AuthController.login);
router.post("/admin/login", authRateLimit, AuthController.adminLogin);
router.post("/password/reset", authRateLimit, AuthController.resetPassword);

router.get("/me", authRequired, AuthController.getCurrentUser);
router.post("/fcm-token", authRequired, writeRateLimit, AuthController.registerFCMToken);
router.post("/password/reset-request", authRateLimit, AuthController.requestPasswordReset);
router.put("/profile", authRequired, writeRateLimit, upload.single('profileImage'), AuthController.updateProfile);
router.delete("/account", authRequired, writeRateLimit, AuthController.deleteAccount);

router.get("/user/preferences", authRequired, AuthController.getUserPreferences);
router.post("/user/preferences", authRequired, AuthController.updateUserPreferences);

router.post("/refresh", authRateLimit, AuthController.refreshToken);

export default router;
