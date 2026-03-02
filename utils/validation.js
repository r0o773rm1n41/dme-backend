// utils/validation.js
import Joi from 'joi';

// Auth validation schemas
export const authSchemas = {
  registerOtp: Joi.object({
    phone: Joi.string()
      .pattern(/^[6-9]\d{9}$/)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid 10-digit Indian mobile number'
      }),

    email: Joi.string()
      .email()
      .optional(),

    mode: Joi.string()
      .valid('SMS', 'EMAIL')
      .default('SMS')
  }).xor('phone', 'email'), // Must provide either phone or email, not both

  verifyOtp: Joi.object({
    contact: Joi.alternatives().try(
      Joi.string().pattern(/^[6-9]\d{9}$/),
      Joi.string().email()
    ).required(),

    otp: Joi.string()
      .pattern(/^\d{6}$/)
      .required()
      .messages({
        'string.pattern.base': 'OTP must be exactly 6 digits'
      }),

    purpose: Joi.string()
      .valid('REGISTER', 'RESET_PASSWORD')
      .required()
  }),

  register: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .required(),

    phone: Joi.string()
      .pattern(/^[6-9]\d{9}$/)
      .required(),

    email: Joi.string()
      .email()
      .optional(),

    password: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      }),

    age: Joi.number()
      .integer()
      .min(13)
      .max(100)
      .optional(),

    gender: Joi.string()
      .valid('Male', 'Female', 'Other')
      .optional(),

    schoolName: Joi.string()
      .trim()
      .max(100)
      .optional(),

    class: Joi.string()
      .valid('10', '12')
      .optional(),

    // Optional referral code entered during registration
    referralCode: Joi.string()
      .trim()
      .max(50)
      .optional(),

    otp: Joi.string()
      .pattern(/^\d{6}$/)
      .required(),

    deviceId: Joi.string()
      .optional()
  }),

  login: Joi.object({
    // allow either a plain 10-digit number or one prefixed with country code 91
    phone: Joi.string()
      .pattern(/^(?:91)?[6-9]\d{9}$/)
      .required(),

    password: Joi.string()
      .required(),

    deviceId: Joi.string()
      .optional()
  }),

  resetPassword: Joi.object({
    contact: Joi.alternatives().try(
      Joi.string().pattern(/^[6-9]\d{9}$/),
      Joi.string().email()
    ).required(),

    otp: Joi.string()
      .pattern(/^\d{6}$/)
      .required(),

    newPassword: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
  }),

  updateProfile: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .optional(),

    age: Joi.number()
      .integer()
      .min(13)
      .max(100)
      .optional(),

    gender: Joi.string()
      .valid('Male', 'Female', 'Other')
      .optional(),

    schoolName: Joi.string()
      .trim()
      .max(100)
      .optional(),

    class: Joi.string()
      .valid('10', '12')
      .optional()
  })
};

// Payment validation schemas
export const paymentSchemas = {
  createOrder: Joi.object({
    amount: Joi.number()
      .integer()
      .min(100) // ₹1 minimum
      .max(100000) // ₹1000 maximum
      .required(),

    currency: Joi.string()
      .valid('INR')
      .default('INR'),

    quizDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
  }),

  verifyPayment: Joi.object({
    razorpay_order_id: Joi.string()
      .required(),

    razorpay_payment_id: Joi.string()
      .required(),

    razorpay_signature: Joi.string()
      .required(),

    quizDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
  }),

  refundRequest: Joi.object({
    paymentId: Joi.string()
      .required(),

    amount: Joi.number()
      .integer()
      .min(100)
      .optional(), // Full refund if not specified

    reason: Joi.string()
      .max(500)
      .optional()
  })
};

// Quiz validation schemas
export const quizSchemas = {
  joinQuiz: Joi.object({
    quizDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),

    deviceId: Joi.string()
      .max(100)
      .optional(),

    deviceFingerprint: Joi.string()
      .max(200)
      .optional()
  }),

  submitAnswer: Joi.object({
    questionId: Joi.string()
      .required(),

    selectedOptionIndex: Joi.number()
      .integer()
      .min(0)
      .max(3)
      .required(),

    timeSpentMs: Joi.number()
      .integer()
      .min(0)
      .max(15000) // Max 15 seconds
      .optional(),

    deviceId: Joi.string()
      .max(100)
      .optional(),

    deviceFingerprint: Joi.string()
      .max(200)
      .optional()
  }),

  createQuiz: Joi.object({
    quizDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),

    classGrade: Joi.string()
      .valid('10', '12')
      .required(),

    questions: Joi.array()
      .items(Joi.object({
        question: Joi.string()
          .trim()
          .min(10)
          .max(500)
          .required(),

        options: Joi.array()
          .items(Joi.string().trim().min(1).max(200))
          .length(4)
          .required(),

        correctIndex: Joi.number()
          .integer()
          .min(0)
          .max(3)
          .required(),

        explanation: Joi.string()
          .trim()
          .max(1000)
          .optional(),

        subject: Joi.string()
          .trim()
          .max(50)
          .optional()
      }))
      .min(50)
      .max(50)
      .required()
  })
};

// Blog validation schemas
export const blogSchemas = {
  createBlog: Joi.object({
    title: Joi.string()
      .trim()
      .min(5)
      .max(100)
      .custom((val, helpers) => {
        const words = val.split(/\s+/).filter(Boolean);
        if (words.length > 30) {
          return helpers.error('string.maxWords', { limit: 30 });
        }
        return val;
      }, 'word count validation')
      .required(),

    content: Joi.string()
      .trim()
      .min(20)
      .max(10000)
      .custom((val, helpers) => {
        const words = val.split(/\s+/).filter(Boolean);
        if (words.length > 300) {
          return helpers.error('string.maxWords', { limit: 300 });
        }
        return val;
      }, 'word count validation')
      .required(),

    tags: Joi.array()
      .items(Joi.string().trim().max(30))
      .max(5)
      .optional(),

    isDraft: Joi.boolean()
      .default(false)
  }),

  updateBlog: Joi.object({
    title: Joi.string()
      .trim()
      .min(5)
      .max(100)
      .custom((val, helpers) => {
        const words = val.split(/\s+/).filter(Boolean);
        if (words.length > 30) {
          return helpers.error('string.maxWords', { limit: 30 });
        }
        return val;
      }, 'word count validation')
      .optional(),

    content: Joi.string()
      .trim()
      .min(20)
      .max(10000)
      .custom((val, helpers) => {
        const words = val.split(/\s+/).filter(Boolean);
        if (words.length > 300) {
          return helpers.error('string.maxWords', { limit: 300 });
        }
        return val;
      }, 'word count validation')
      .optional(),

    tags: Joi.array()
      .items(Joi.string().trim().max(30))
      .max(5)
      .optional(),

    isDraft: Joi.boolean()
      .optional()
  })
};

// Admin validation schemas
export const adminSchemas = {
  blockUser: Joi.object({
    userId: Joi.string()
      .required(),

    reason: Joi.string()
      .max(500)
      .required(),

    duration: Joi.number()
      .integer()
      .min(0) // 0 = permanent
      .optional()
  }),

  approveBlog: Joi.object({
    blogId: Joi.string()
      .required(),

    approved: Joi.boolean()
      .required(),

    moderatorNotes: Joi.string()
      .max(500)
      .optional()
  }),

  createQuestions: Joi.object({
    questions: Joi.array()
      .items(Joi.object({
        question: Joi.string()
          .trim()
          .min(10)
          .max(500)
          .required(),

        options: Joi.array()
          .items(Joi.string().trim().min(1).max(200))
          .length(4)
          .required(),

        correctIndex: Joi.number()
          .integer()
          .min(0)
          .max(3)
          .required(),

        explanation: Joi.string()
          .trim()
          .max(1000)
          .optional(),

        subject: Joi.string()
          .trim()
          .max(50)
          .optional(),

        difficulty: Joi.string()
          .valid('EASY', 'MEDIUM', 'HARD')
          .optional()
      }))
      .min(1)
      .max(100)
      .required()
  })
};

// Middleware function to validate requests
export const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = source === 'params' ? req.params : source === 'query' ? req.query : req.body;
    const { error, value } = schema.validate(data, { abortEarly: false });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        message: 'Validation failed',
        errors
      });
    }

    if (source === 'params') req.params = value;
    else if (source === 'query') req.query = value;
    else req.body = value; // Use validated/sanitized data
    next();
  };
};

// Sanitize input to prevent XSS
export const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<[^>]*>/g, '')
                .trim();
  }
  return input;
};