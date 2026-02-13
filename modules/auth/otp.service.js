// modules/auth/otp.service.js
import crypto from "crypto";
import redis from "../../config/redis.js";
import { sendSMS } from "../../utils/sms.js";
import { sendEmailOTP } from "../../utils/email.js";

const OTP_TTL = Number(process.env.OTP_TTL_MS || 300000);
const MAX_ATTEMPTS = 10; // Changed from 3 to 5
const OTP_RATE_LIMIT = 10; // Max OTP requests per 5 min per user (increased from 5)
const OTP_RATE_WINDOW = 300000; // 5 min in ms (decreased from 15 min)

function hashOtp(otp) {
  return crypto
    .createHmac("sha256", process.env.OTP_HASH_SECRET)
    .update(otp)
    .digest("hex");
}

export async function generateOtp(key, purpose, contact, mode = 'SMS') {
  // Rate limiting: check OTP request frequency
  const rateKey = `otp_rate_${key}`;
  const currentRequests = await redis.get(rateKey);
  const requestCount = currentRequests ? parseInt(currentRequests) : 0;

  if (requestCount >= OTP_RATE_LIMIT) {
    throw new Error("OTP request limit exceeded. Please try again later.");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const otpData = {
    contact,
    purpose,
    mode,
    hash: hashOtp(otp),
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL,
    consumed: false
  };
  console.log('Storing OTP data for key:', key, 'Data:', otpData);

  await redis.set(
    key,
    otpData,
    { ex: Math.floor(OTP_TTL / 1000) }
  );

  // Increment rate limit counter
  await redis.set(rateKey, requestCount + 1, { ex: Math.floor(OTP_RATE_WINDOW / 1000) });

  // Send OTP via appropriate channel
  try {
    if (mode === 'EMAIL') {
      await sendEmailOTP(contact, otp);
    } else {
      await sendSMS(contact, otp);
    }
  } catch (error) {
    console.error(`Failed to send ${mode} OTP:`, error);
    throw new Error(`Failed to send OTP via ${mode}`);
  }

  return otp;
}

export async function verifyOtp(key, otp, expectedPurpose) {
  const data = await redis.get(key);
  console.log('Retrieved OTP data for key:', key, 'Data:', data);
  if (!data) throw new Error("OTP expired or invalid");

  // Handle both parsed and string data
  let parsed;
  if (typeof data === 'string') {
    parsed = JSON.parse(data);
  } else {
    parsed = data;
  }

  // Check purpose (case-insensitive comparison)
  if (parsed.purpose.toUpperCase() !== expectedPurpose.toUpperCase()) {
    throw new Error("Invalid OTP purpose");
  }

  // Check if already consumed
  if (parsed.consumed) {
    await redis.del(key);
    throw new Error("OTP already used");
  }

  // Check expiration
  if (Date.now() > parsed.expiresAt) {
    await redis.del(key);
    throw new Error("OTP expired");
  }

  if (parsed.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    throw new Error("OTP attempts exceeded");
  }

  if (parsed.hash !== hashOtp(otp.trim())) {
    parsed.attempts += 1;
    await redis.set(key, JSON.stringify(parsed), { ex: Math.floor(OTP_TTL / 1000) });
    throw new Error("Invalid OTP");
  }

  // Mark as consumed and delete immediately
  await redis.del(key);
  return true;
}
