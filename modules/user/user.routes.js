// modules/user/user.routes.js
import express from 'express';
import multer from 'multer';
import User from './user.model.js';
import { authRequired } from '../../middlewares/auth.middleware.js';
import { getUserStreakStats, generateReferralCode, processReferral } from './streak.service.js';
import { createSubscription, renewSubscription, cancelSubscription, getSubscriptionStatus, processSubscriptionPayment, SUBSCRIPTION_TIERS } from './subscription.service.js';
import cloudinary from '../../config/cloudinary.js';
import { isUserEligible } from '../payment/payment.service.js';

const router = express.Router();

// Configure multer for image upload
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Get user eligibility for today's quiz
router.get('/me/eligibility', authRequired, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const eligible = await isUserEligible(req.user._id, today);
    res.json({ eligible });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user by ID (public route for viewing user profiles)
router.get('/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('name email createdAt');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user profile with gamification stats
router.get('/profile', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get streak stats
    const streakStats = await getUserStreakStats(req.user._id);

    // Get subscription status
    const subscriptionStatus = await getSubscriptionStatus(req.user._id);

    res.json({
      user,
      gamification: {
        streaks: streakStats,
        subscription: subscriptionStatus
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get streak statistics
router.get('/streaks', authRequired, async (req, res) => {
  try {
    const streakStats = await getUserStreakStats(req.user._id);
    res.json(streakStats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generate referral code
router.post('/referral-code', authRequired, async (req, res) => {
  try {
    const referralCode = await generateReferralCode(req.user._id);
    if (!referralCode) {
      return res.status(400).json({ message: 'Failed to generate referral code' });
    }
    res.json({ referralCode });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Process referral (when new user signs up with referral code)
router.post('/referral/:code', authRequired, async (req, res) => {
  try {
    const success = await processReferral(req.params.code, req.user._id);
    if (!success) {
      return res.status(400).json({ message: 'Invalid referral code' });
    }
    res.json({ message: 'Referral processed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Subscription management
router.get('/subscription', authRequired, async (req, res) => {
  try {
    const status = await getSubscriptionStatus(req.user._id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/subscription', authRequired, async (req, res) => {
  try {
    const { tier } = req.body;
    const result = await processSubscriptionPayment(req.user._id, tier, SUBSCRIPTION_TIERS[tier].price);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/subscription/renew', authRequired, async (req, res) => {
  try {
    const result = await renewSubscription(req.user._id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/subscription/cancel', authRequired, async (req, res) => {
  try {
    const result = await cancelSubscription(req.user._id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Upload profile image (Cloudinary)
router.post('/upload-image', authRequired, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "profile-images",
      resource_type: "image",
      transformation: [
        { width: 400, height: 400, crop: "fill", gravity: "face" },
        { quality: "auto", fetch_format: "auto" }
      ],
      overwrite: true,
      invalidate: true
    });

    // Delete old profile image from Cloudinary if exists
    const user = await User.findById(req.user._id);
    if (user.profileImage) {
      try {
        await cloudinary.uploader.destroy(user.profileImage);
      } catch (error) {
        // Failed to delete old profile image
      }
    }

    // Update user profile image
    user.profileImage = result.public_id;
    await user.save();

    // Delete uploaded file from local storage
    const fs = await import('fs');
    if (req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (error) {
        // Failed to delete local file
      }
    }

    // Return Cloudinary URL
    res.json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      user: {
        _id: user._id,
        name: user.name,
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    // Profile image upload error
    res.status(400).json({ message: error.message || 'Failed to upload profile image' });
  }
});

export default router;