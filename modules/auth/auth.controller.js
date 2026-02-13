// modules/auth/auth.controller.js
import * as AuthService from "./auth.service.js";
import cloudinary from "../../config/cloudinary.js";
import { validate, authSchemas } from "../../utils/validation.js";

export async function sendRegisterOtp(req, res) {
  try {
    const otp = await AuthService.requestRegisterOtp(req.body);
    res.json({ success: true }); // Do not send OTP in response for security
  } catch (error) {
    res.status(400).json({ message: typeof error.message === 'string' ? error.message : 'An error occurred' });
  }
}

export async function register(req, res) {
  try {
    const { user, tokens } = await AuthService.registerUser(req.body);
    res.json({
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        age: user.age,
        gender: user.gender,
        schoolName: user.schoolName,
        classGrade: user.class === '10' ? '10th' : user.class === '12' ? '12th' : 'Other',
        profileCompleted: user.profileCompleted
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).send(`ValidationError: ${JSON.stringify(error.errors)}`);
    }
    // Handle other errors
    const message = `Error: ${error.name} - ${String(error.message)} - Stack: ${error.stack}`;
    res.status(400).send(message);
  }
}

export async function login(req, res) {
  try {
    const { user, tokens } = await AuthService.loginUser(req.body);
    res.json({
      user: {
        _id: user._id,
        name: user.name,
        fullName: user.fullName,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
        isVerified: user.phoneVerified || user.emailVerified
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (error) {
    res.status(400).json({ message: typeof error.message === 'string' ? error.message : 'An error occurred' });
  }
}

export async function adminLogin(req, res) {
  try {
    const { user, tokens } = await AuthService.adminLogin(req.body);
    res.json({
      user: {
        _id: user._id,
        name: user.name,
        fullName: user.fullName,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function getCurrentUser(req, res) {
  try {
    // Populate full user data
    const User = (await import("../user/user.model.js")).default;
    const user = await User.findById(req.user._id).select('-passwordHash');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      user: {
        _id: user._id,
        name: user.name,
        fullName: user.fullName,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
        isVerified: user.phoneVerified || user.emailVerified,
        createdAt: user.createdAt,
        age: user.age,
        gender: user.gender,
        schoolName: user.schoolName,
        classGrade: user.class === '10' ? '10th' : user.class === '12' ? '12th' : 'Other',
        profileCompleted: user.profileCompleted
      }
    });
  } catch (error) {
    console.error('getCurrentUser error:', error);
    res.status(401).json({ message: 'Unauthorized' });
  }
}

export async function refreshToken(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token required" });
    }
    const tokens = await AuthService.refreshAccessToken(refreshToken);
    res.json(tokens);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
}

export async function sendResetOtp(req, res) {
  try {
    const otp = await AuthService.requestPasswordReset(req.body.phone);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}


export async function registerFCMToken(req, res) {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    await AuthService.updateFCMToken(req.user._id, fcmToken);
    res.json({ success: true, message: 'FCM token registered successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function requestPasswordReset(req, res) {
  try {
    await AuthService.requestPasswordReset(req.body.phone);
    res.json({ success: true, message: 'Password reset OTP sent' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function resetPassword(req, res) {
  try {
    await AuthService.resetPassword(req.body);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function updateProfile(req, res) {
  try {
    let profileImageUrl = null;

    // Handle profile image upload to Cloudinary
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'profile-images',
            public_id: `user_${req.user._id}_${Date.now()}`,
            transformation: [
              { width: 300, height: 300, crop: 'fill' },
              { quality: 'auto' }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });
      profileImageUrl = result.secure_url;
    }

    // Prepare updates object
    const updates = { ...req.body };
    if (profileImageUrl) {
      updates.profileImage = profileImageUrl;
    }

    const updatedUser = await AuthService.updateProfile(req.user._id, updates);
    res.json({
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        fullName: updatedUser.fullName,
        username: updatedUser.username,
        phone: updatedUser.phone,
        email: updatedUser.email,
        age: updatedUser.age,
        gender: updatedUser.gender,
        schoolName: updatedUser.schoolName,
        classGrade: updatedUser.class === '10' ? '10th' : updatedUser.class === '12' ? '12th' : 'Other',
        role: updatedUser.role,
        profileImage: updatedUser.profileImage
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function deleteAccount(req, res) {
  try {
    await AuthService.deleteAccount(req.user._id);
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function getUserPreferences(req, res) {
  try {
    const preferences = await AuthService.getUserPreferences(req.user._id);
    res.json({ preferences });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

export async function updateUserPreferences(req, res) {
  try {
    const preferences = await AuthService.updateUserPreferences(req.user._id, req.body.preferences);
    res.json({ preferences });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}
