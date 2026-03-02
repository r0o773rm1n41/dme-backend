#!/usr/bin/env node
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const userSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["USER", "QUIZ_ADMIN", "CONTENT_ADMIN", "SUPER_ADMIN"],
    default: "USER",
  },
  name: String,
  phone: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, sparse: true },
  passwordHash: { type: String, required: true },
  phoneVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  otpMode: { type: String, enum: ["SMS", "EMAIL"], immutable: true },
  profileImage: String,
  fcmToken: { type: String, sparse: true },
  isBlocked: { type: Boolean, default: false },
  profileCompleted: { type: Boolean, default: false },
  lastLoginAt: Date,
  fullName: String,
  username: { type: String, unique: true, sparse: true },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

async function createAdmin() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dme';
    await mongoose.connect(mongoUri);
    console.log('📦 Connected to MongoDB');

    const phone = '9999999999';
    const password = '@bnn1niSE';  // From .env ADMIN_PASSWORD
    const name = 'Admin User';

    // Find the existing admin user in the database
    const existing = await User.findOne({ phone });
    
    if (existing) {
      console.log('⚠️  Found existing user with phone:', phone);
      console.log('   Current role:', existing.role);
      console.log('   Current name:', existing.name);
      
      const passwordHash = await bcrypt.hash(password, 12);
      
      // Update to ensure SUPER_ADMIN role and correct password
      await User.updateOne(
        { _id: existing._id }, 
        { 
          $set: { 
            role: 'SUPER_ADMIN',
            passwordHash: passwordHash,
            name: name,
            fullName: name
          } 
        }
      );
      console.log('✅ Updated user to SUPER_ADMIN role');
      console.log(`\n📋 Admin Credentials:\nPhone: ${phone}\nPassword: ${password}`);
      process.exit(0);
    }

    console.log('❌ No user found with phone:', phone);
    process.exit(1);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createAdmin();
