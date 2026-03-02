// config/env-validation.js
import Joi from 'joi';

const envSchema = Joi.object({
  // Server
  PORT: Joi.number().default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Database
  MONGODB_URI: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('mongodb://localhost:27017/dme') }),

  // Redis
  // REDIS_URL: Joi.string().default('redis://localhost:6379'),
  // Redis (Upstash REST)
UPSTASH_REDIS_REST_URL: Joi.string().when('NODE_ENV', {
  is: 'production',
  then: Joi.required(),
  otherwise: Joi.string().optional()
}),
UPSTASH_REDIS_REST_TOKEN: Joi.string().when('NODE_ENV', {
  is: 'production',
  then: Joi.required(),
  otherwise: Joi.string().optional()
}),


  // JWT
  JWT_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('dev_jwt_secret') }),
  JWT_REFRESH_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('dev_refresh_secret') }),

  // OTP
  OTP_HASH_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('dev_otp_secret') }),
  OTP_TTL_MS: Joi.number().default(180000),

  // Email (optional for now)
  EMAIL_USER: Joi.string().optional(),
  EMAIL_APP_PASSWORD: Joi.string().optional(),

  // SMS (required in production)
  TWOFACTOR_API_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),
  OTP_PROVIDER_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),

  // Cloudinary (optional in development)
  CLOUDINARY_CLOUD_NAME: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),
  CLOUDINARY_API_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),
  CLOUDINARY_API_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),

  // Razorpay (optional in development)
  RAZORPAY_KEY_ID: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('your_razorpay_key_id') }),
  RAZORPAY_KEY_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('your_razorpay_key_secret') }),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('') }),

  // Timezone
  TZ: Joi.string().default('Asia/Kolkata'),

}).unknown(); // Allow unknown env vars

export function validateEnvironment() {
  const { error, value } = envSchema.validate(process.env, { allowUnknown: true });

  if (error) {
    console.error('❌ Environment validation failed:', error.details);
    // H1: Fail startup if missing required secrets
    throw new Error(`Environment validation failed: ${error.details.map(d => d.message).join(', ')}`);
  }

  // H1: Additional validation for production
  if (process.env.NODE_ENV === 'production') {
    const requiredSecrets = [
      'MONGODB_URI',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN'
    ];
    
    const missingSecrets = requiredSecrets.filter(key => !process.env[key] || process.env[key].trim() === '');
    if (missingSecrets.length > 0) {
      console.error('❌ Missing required secrets in production:', missingSecrets);
      throw new Error(`Missing required secrets: ${missingSecrets.join(', ')}`);
    }

    // Validate secret strength
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
  }

  // Set defaults
  Object.keys(value).forEach(key => {
    if (value[key] !== undefined) {
      process.env[key] = value[key];
    }
  });

  console.log('✅ Environment variables validated successfully');
  return value;
}
