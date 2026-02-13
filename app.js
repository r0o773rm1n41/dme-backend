// backend/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRoutes from "./modules/auth/auth.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import adminAuthRoutes from "./modules/admin/adminAuth.routes.js";
import blogRoutes from "./modules/blog/blog.routes.js";
import quizRoutes from "./modules/quiz/quiz.routes.js";
import paymentRoutes from "./modules/payment/payment.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import reportRoutes from "./modules/reports/report.routes.js";
import { sanitizeInput } from "./middlewares/sanitization.middleware.js";
import { requestLogger, healthCheck } from "./middlewares/monitoring.middleware.js";
import { generalRateLimit } from "./middlewares/rate-limit.middleware.js";
import * as Sentry from '@sentry/node';

const app = express();

if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
}

// CORS configuration - MUST be before other middleware that might block preflight requests
// const allowedOrigins = [
//   'http://localhost:3000',
//   'http://localhost:3001',
//   'https://dme-frontend.vercel.app',
//   'https://www.dailymindeducation.com',
//   'https://dme-frontend-kc8r25r6q-hnnns-projects.vercel.app',
//   'https://dme-frontend-4li6hd0p9-hnnns-projects.vercel.app',
//   'https://dme-frontend-jcvk4k5xv-hnnns-projects.vercel.app',
//   process.env.FRONTEND_URL
// ].filter(Boolean);
const allowedOrigins = [
  'http://localhost:5173',   // ✅ ADD THIS
  'http://localhost:3000',
  'http://localhost:3001',
  'https://dme-frontend.vercel.app',
  'https://www.dailymindeducation.com',
  'https://dme-frontend-kc8r25r6q-hnnns-projects.vercel.app',
  'https://dme-frontend-4li6hd0p9-hnnns-projects.vercel.app',
  'https://dme-frontend-jcvk4k5xv-hnnns-projects.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // allow non-browser requests (curl, Postman)
    if (!origin) return callback(null, true);

    // allow if in allowed list
    if (allowedOrigins.some(o => o === origin)) {
      return callback(null, true);
    }

    // allow all Vercel domains (*.vercel.app)
    if (origin && origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    console.warn(`Blocked CORS request from: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Authorization'],
  optionsSuccessStatus: 200
}));

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting
app.use(generalRateLimit);

// Compression
app.use(compression({
  level: 6,
  threshold: 100 * 1000, // 100kb
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Input sanitization
app.use(sanitizeInput);

// Health check endpoint
app.get('/health', healthCheck);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin-auth", adminAuthRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", userRoutes);
app.use("/api/reports", reportRoutes);

if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

export default app;
