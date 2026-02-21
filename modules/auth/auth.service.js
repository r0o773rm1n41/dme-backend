// modules/auth/auth.service.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../user/user.model.js";
import { generateOtp, verifyOtp } from "./otp.service.js";
import { sendOTP } from "../../utils/sms.js";
import { sendEmailOTP } from "../../utils/email.js";

function signTokens(user) {
  // Accept either a uid string or a user-like object. Only include `uid` when available
  // Defensive: avoid the literal string 'undefined' as a uid (seen in some runs)
  let rawId = (typeof user === 'string') ? user : (user && (user._id || user.userId || user.id || (user._doc && user._doc._id)));
  const phone = (typeof user === 'object') ? user.phone : undefined;
  const role = (typeof user === 'object') ? user.role : undefined;

  // If rawId is falsy or is the string 'undefined', fall back to phone if available
  if (!rawId || String(rawId).toLowerCase() === 'undefined') {
    rawId = phone || undefined;
  }

  const accessPayload = {};
  if (rawId) accessPayload.uid = String(rawId);
  if (phone) accessPayload.phone = phone;
  if (role) accessPayload.role = role;

  const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, { expiresIn: '15m' });

  const refreshPayload = {};
  if (rawId) refreshPayload.uid = String(rawId);
  if (phone) refreshPayload.phone = phone;

  const refreshToken = jwt.sign(refreshPayload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken) {
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(payload.uid);
    if (!user) throw new Error("Invalid refresh token");

    const newAccessToken = jwt.sign(
      { uid: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return { accessToken: newAccessToken };
  } catch (err) {
    throw new Error("Invalid or expired refresh token");
  }
}

/* ---------------- REGISTER ---------------- */

export async function requestRegisterOtp({ phone, email, mode = 'SMS' }) {
  if (!!phone === !!email)
    throw new Error("Provide either phone or email");

  // Normalize phone number
  let normalizedPhone = phone;
  if (phone) {
    normalizedPhone = phone.replace(/[\+\s-]/g, '');
    if (normalizedPhone.length === 10 && /^\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = '91' + normalizedPhone;
    }
  }

  // Check if user already exists and enforce their OTP mode
  let existingUser = null;
  if (normalizedPhone) {
    existingUser = await User.findOne({ phone: normalizedPhone });
  } else if (email) {
    existingUser = await User.findOne({ email });
  }

  if (existingUser) {
    // If user exists but doesn't have otpMode set (legacy user), allow either
    if (existingUser.otpMode) {
      // Enforce existing OTP mode
      if (existingUser.otpMode !== mode) {
        throw new Error(`OTP must be sent via ${existingUser.otpMode.toLowerCase()}`);
      }
    }
  }

  const key = normalizedPhone
    ? `otp:register:phone:${normalizedPhone}`
    : `otp:register:email:${email}`;

  const contact = normalizedPhone || email;
  const otp = await generateOtp(key, 'REGISTER', contact, mode);

  return { success: true, mode };
}

export async function registerUser({ phone, email, otp, password, name, age, gender, schoolName, classGrade }) {
  // Normalize phone number
  let normalizedPhone = phone;
  if (phone) {
    normalizedPhone = phone.replace(/[\+\s-]/g, '');
    if (normalizedPhone.length === 10 && /^\d{10}$/.test(normalizedPhone)) {
      normalizedPhone = '91' + normalizedPhone;
    }
  }

  // For development/testing - skip OTP verification
  if (process.env.NODE_ENV === 'development' && !otp) {
    // Skip OTP verification in development
  } else {
    const key = normalizedPhone
      ? `otp:register:phone:${normalizedPhone}`
      : `otp:register:email:${email}`;

    await verifyOtp(key, otp, 'register');
  }

  // Determine OTP mode and set it immutably
  const otpMode = phone ? "SMS" : "EMAIL";

  // Map classGrade to class field
  let classValue = null;
  if (classGrade === '10th') {
    classValue = '10';
  } else if (classGrade === '12th') {
    classValue = '12';
  } else if (classGrade === 'Other') {
    classValue = 'Other';
  }

  // Build query - only include email if provided and non-empty
  let existingQuery;
  if (email && email.trim()) {
    existingQuery = {
      $or: [{ phone: normalizedPhone }, { email: email.trim() }]
    };
  } else {
    // Only search by phone if no email provided
    existingQuery = { phone: normalizedPhone };
  }
  
  const existing = await User.findOne(existingQuery);
  if (existing) {
    // Only allow updating if it's the same user (same phone or email verified by OTP)
    // Don't update unrelated admin accounts
    if (existing.role && existing.role !== 'USER') {
      throw new Error("This account is an admin account and cannot be re-registered");
    }
    // Update existing user with new registration data
    existing.name = name;
    existing.passwordHash = await bcrypt.hash(password, 12);
    existing.age = age;
    existing.gender = gender;
    existing.schoolName = schoolName;
    existing.class = classValue;
    existing.phoneVerified = !!phone;
    existing.isPhoneVerified = !!phone;
    existing.emailVerified = !!email;
    existing.otpMode = otpMode;
    existing.profileCompleted = false;
    await existing.save();
    const uid = String(existing._id || existing.userId || existing.id || (existing._doc && existing._doc._id));
    const tokens = signTokens({ _id: uid, phone: existing.phone, role: existing.role });
    return { user: existing, tokens };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await User.create({
    name,
    phone: normalizedPhone,
    email,
    passwordHash,
    phoneVerified: !!phone,
    isPhoneVerified: !!phone,
    emailVerified: !!email,
    otpMode, // Lock OTP mode after first verification
    age,
    gender,
    schoolName,
    class: classValue,
    profileCompleted: false // Will be set to true after profile completion
  });

  const uid = String(user._id || user.userId || user.id || (user._doc && user._doc._id));
  const tokens = signTokens({ _id: uid, phone: user.phone, role: user.role });
  return { user, tokens };
}

/* ---------------- LOGIN ---------------- */

export async function loginUser({ phone, password }) {
  // Only allow login with phone number
  if (!phone) throw new Error("Phone number is required for login");
  if (!password) throw new Error("Password is required");

  // Validate phone number format (10 digits)
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
    throw new Error("Please enter a valid 10-digit phone number");
  }

  // Normalize phone number (same as registration)
  let normalizedPhone = phone.replace(/[\+\s-]/g, '');
  if (normalizedPhone.length === 10 && /^\d{10}$/.test(normalizedPhone)) {
    normalizedPhone = '91' + normalizedPhone;
  }

  const user = await User.findOne({ phone: normalizedPhone });
  if (!user) throw new Error("Invalid credentials");

  // Only allow USER role to login via normal login (not admins)
  if (user.role && user.role !== 'USER') {
    throw new Error("Invalid credentials - admin accounts must use admin login");
  }

  if (!user.isPhoneVerified) throw new Error("Phone number not verified. Please verify your phone number first.");

  if (!user.passwordHash) throw new Error("Invalid credentials");

  // Validate password is a string before comparing
  if (typeof password !== 'string') {
    throw new Error("Invalid password format");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  // Update lastLoginAt using an atomic update to avoid validating entire document
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  const uid = String(user._id || user.userId || user.id || (user._doc && user._doc._id));
  const tokens = signTokens({ _id: uid, phone: user.phone, role: user.role });
  return { user, tokens };
}

/* ---------------- ADMIN LOGIN ---------------- */

export async function adminLogin({ phone, password }) {
  // Validate phone number format (10 digits)
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
    throw new Error("Please enter a valid 10-digit phone number");
  }

  // For admin login, don't normalize phone number (admins may have different formats)
  const normalizedPhone = phone.replace(/\D/g, '');

  const user = await User.findOne({ 
    phone: normalizedPhone, 
    role: { $in: ["ADMIN", "SUPER_ADMIN", "QUIZ_ADMIN", "CONTENT_ADMIN"] }
  });
  if (!user) throw new Error("Invalid admin credentials");

  if (!user.passwordHash) throw new Error("Invalid admin credentials");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("Invalid admin credentials");

  // Update lastLoginAt using an atomic update to avoid validating entire document
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  const tokens = signTokens(user);
  return { user, tokens };
}

/* ---------------- RESET PASSWORD ---------------- */

export async function requestPasswordReset(phone) {
  if (!phone) throw new Error("Phone required");

  // Normalize phone number (same as registration)
  let normalizedPhone = phone.replace(/[\+\s-]/g, '');
  if (normalizedPhone.length === 10 && /^\d{10}$/.test(normalizedPhone)) {
    normalizedPhone = '91' + normalizedPhone;
  }

  const user = await User.findOne({ phone: normalizedPhone });
  if (!user) throw new Error("User not found");

  // Enforce OTP mode: password reset must use the user's registered OTP mode
  if (!user.otpMode) {
    throw new Error("User OTP mode not set");
  }

  let key, otp;
  if (user.otpMode === "SMS") {
    key = `otp:reset:phone:${normalizedPhone}`;
    otp = await generateOtp(key, 'reset', phone);

    try {
      await sendOTP(phone, otp);
    } catch (error) {
      console.error('Failed to send password reset OTP SMS:', error);
      // Don't throw error here - OTP is still valid and stored
    }
  } else if (user.otpMode === "EMAIL") {
    if (!user.email) {
      throw new Error("User email not available for password reset");
    }

    key = `otp:reset:email:${user.email}`;
    otp = await generateOtp(key, 'reset', user.email);

    try {
      await sendEmailOTP(user.email, otp);
    } catch (error) {
      console.error('Failed to send password reset OTP email:', error);
      // Don't throw error here - OTP is still valid and stored
    }
  } else {
    throw new Error("Invalid OTP mode");
  }

  return otp; // For development/testing - remove in production
}

export async function resetPassword({ phone, otp, newPassword }) {
  if (!phone) throw new Error("Phone required");

  // Normalize phone number (same as registration)
  let normalizedPhone = phone.replace(/[\+\s-]/g, '');
  if (normalizedPhone.length === 10 && /^\d{10}$/.test(normalizedPhone)) {
    normalizedPhone = '91' + normalizedPhone;
  }

  const user = await User.findOne({ phone: normalizedPhone });
  if (!user) throw new Error("User not found");

  // Verify OTP using the user's registered OTP mode
  let key;
  if (user.otpMode === "SMS") {
    key = `otp:reset:phone:${normalizedPhone}`;
  } else if (user.otpMode === "EMAIL") {
    key = `otp:reset:email:${user.email}`;
  } else {
    throw new Error("Invalid OTP mode");
  }

  await verifyOtp(key, otp, 'reset');

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  return true;
}

export async function updateFCMToken(userId, fcmToken) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.fcmToken = fcmToken;
  await user.save();

  return true;
}

export async function updateProfile(userId, updates) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Define immutable fields that cannot be changed once set
  const immutableFields = ['age', 'gender', 'schoolName', 'classGrade'];

  // Allow updating profile fields, but prevent changing immutable fields once set
  const allowedFields = ['name', 'fullName', 'username', 'email', 'age', 'gender', 'schoolName', 'classGrade', 'profileImage'];
  allowedFields.forEach(field => {
    if (updates[field] !== undefined) {
      // Check if this is an immutable field that already has a value
      if (immutableFields.includes(field) && user[field] !== null && user[field] !== undefined && user[field] !== '') {
        // Field is already set and immutable - skip the update (don't change it)
        // But allow if the value is the same (no actual change)
        if (updates[field] !== user[field]) {
          console.log(`Field ${field} is immutable and already set. Skipping update.`);
          return; // Skip this field, continue with next
        }
      } else {
        // Field can be updated (either not immutable or not yet set)
        if (field === 'classGrade') {
          // Map classGrade to class field
          let classValue = null;
          if (updates.classGrade === '10th') {
            classValue = '10';
          } else if (updates.classGrade === '12th') {
            classValue = '12';
          } else if (updates.classGrade === 'Other') {
            classValue = 'Other';
          }
          user.class = classValue;
        } else {
          user[field] = updates[field];
        }
      }
    }
  });

  // Update name if fullName is provided
  if (updates.fullName && !updates.name) {
    user.name = updates.fullName;
  }

  // Check if profile is now complete
  const requiredFields = ['fullName', 'username', 'age', 'gender', 'schoolName', 'class'];
  const isProfileComplete = requiredFields.every(field => {
    if (field === 'class') {
      return user.class !== null && user.class !== undefined;
    }
    return user[field] !== null && user[field] !== undefined && user[field] !== '';
  });

  if (isProfileComplete && !user.profileCompleted) {
    user.profileCompleted = true;
  }

  await user.save();
  return user;
}

export async function deleteAccount(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Soft delete - anonymize user data
  user.isBlocked = true;
  user.name = 'Deleted User';
  user.phone = null;
  user.email = null;
  user.fcmToken = null;
  user.profileImage = null;
  await user.save();

  // Note: We keep the user record for audit purposes but anonymize personal data
  // Related data (payments, quiz attempts, etc.) should be handled by GDPR compliance features

  return true;
}

export async function getUserPreferences(userId) {
  const user = await User.findById(userId).select('preferences');
  if (!user) {
    throw new Error('User not found');
  }
  return user.preferences || {};
}

export async function updateUserPreferences(userId, preferences) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  user.preferences = { ...user.preferences, ...preferences };
  await user.save();
  return user.preferences;
}
