
// backend/server.js
import dotenv from 'dotenv';
dotenv.config();

// Enforce Indian timezone globally
process.env.TZ = 'Asia/Kolkata';

// Validate environment variables
import { validateEnvironment } from './config/env-validation.js';
validateEnvironment();

import * as Sentry from '@sentry/node';
import logger from './utils/logger.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
  // Sentry initialized
}

import express from 'express';
import cors from 'cors';
import app from './app.js';
import { startQuizScheduler, stopQuizScheduler } from './modules/quiz/quiz.scheduler.js';
import { recoverQuizAdvancement, stopQuizIntervals } from './modules/quiz/quiz.service.js';
import mongoose from 'mongoose';
import redisClient from './config/redis.js';
import connectDB from './config/database.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from './modules/user/user.model.js';
import ObservabilityService from './modules/monitoring/observability.service.js';
import { revalidateSocketAuth } from './utils/socketAuth.js';

// ---------------------------------------------

const PORT = process.env.PORT || 5000;

// Socket connection tracking
const socketConnections = new Map();
const MAX_SOCKETS_PER_IP = 5;

// Allowed origins for Socket.IO (local included)
const allowedOrigins = [
  'https://dme-frontend.vercel.app',
  'https://www.dailymindeducation.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

async function startServer() {
  try {
    // Connect MongoDB
    await connectDB();

    // Init Redis (safe for local)
    try {
      if (typeof redisClient.connect === 'function') {
        await redisClient.connect();
      }
      // Redis ready
    } catch (err) {
      // Redis unavailable, continuing locally
    }

    // Create HTTP server
    const server = createServer(app);

    // Socket.IO
    const io = new Server(server, {
      cors: {
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    global.io = io;

    // Socket auth middleware
    io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.split(' ')[1];

        if (!token) return next(new Error('Authentication required'));

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        // Use findOne to support string _id values (seeded test users)
        const user = await User.findOne({ _id: payload.uid }).select('-passwordHash');

        if (!user) return next(new Error('Invalid user'));

        socket.user = user;
        next();
      } catch (err) {
        next(new Error('Authentication failed'));
      }
    });

    // Rate limiting
    const socketEventCounts = new Map();
    const SOCKET_EVENT_LIMITS = {
      'join-quiz': 10,
      pong: 60
    };

    io.on('connection', (socket) => {
      const clientIP = socket.handshake.address;

      if (!socketConnections.has(clientIP)) {
        socketConnections.set(clientIP, new Set());
      }

      const ipSockets = socketConnections.get(clientIP);
      if (ipSockets.size >= MAX_SOCKETS_PER_IP) {
        socket.disconnect(true);
        return;
      }

      ipSockets.add(socket.id);
      socketEventCounts.set(socket.id, new Map());

      // Socket connected

      socket.on('join-quiz', async (quizDate) => {
        try {
          const auth = await revalidateSocketAuth(socket);
          if (!auth.valid) {
            // If token is expiring soon, prompt frontend to refresh
            if (auth.reason === 'token_expiring_soon' || auth.reason === 'expired') {
              socket.emit('reauth', { message: 'Token expiring soon, please refresh.' });
            }
            // Always disconnect unauthorized or expired
            socket.disconnect(true);
            return;
          }

          const counts = socketEventCounts.get(socket.id);
          const count = (counts.get('join-quiz') || 0) + 1;
          if (count > SOCKET_EVENT_LIMITS['join-quiz']) return;

          counts.set('join-quiz', count);

          const QuizAttempt = (await import('./modules/quiz/quizAttempt.model.js')).default;
          const attempt = await QuizAttempt.findOne({
            user: socket.user._id,
            quizDate
          });

          if (!attempt) return;

          socket.join(`quiz-${quizDate}`);
        } catch (err) {
          // Never leak internal error reasons
          socket.emit('error', { message: 'Unauthorized' });
          socket.disconnect(true);
        }
      });

      const heartbeat = setInterval(() => {
        socket.emit('ping', Date.now());
      }, 30000);

      socket.on('pong', () => {});

      socket.on('disconnect', () => {
        clearInterval(heartbeat);
        socketEventCounts.delete(socket.id);

        const set = socketConnections.get(clientIP);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) socketConnections.delete(clientIP);
        }

        // Socket disconnected
      });
    });

    server.listen(PORT, () => {
      // Server running locally
    });

    const shutdown = async () => {
      stopQuizScheduler();
      stopQuizIntervals();
      await mongoose.connection.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    startQuizScheduler();
    await recoverQuizAdvancement();

  } catch (error) {
    // Failed to start server
    process.exit(1);
  }
}

startServer();


// // // backend/server.js
// // backend/server.js
// import dotenv from 'dotenv';
// dotenv.config();

// // Enforce Indian timezone globally
// process.env.TZ = 'Asia/Kolkata';

// // Validate environment variables
// import { validateEnvironment } from './config/env-validation.js';
// validateEnvironment();

// import * as Sentry from '@sentry/node';
// import logger from './utils/logger.js';

// if (process.env.SENTRY_DSN) {
//   Sentry.init({ dsn: process.env.SENTRY_DSN });
//   console.log('Sentry initialized');
// }

// import express from 'express';
// import cors from 'cors';
// import app from './app.js';
// import { startQuizScheduler, stopQuizScheduler } from './modules/quiz/quiz.scheduler.js';
// import { recoverQuizAdvancement, stopQuizIntervals } from './modules/quiz/quiz.service.js';
// import mongoose from 'mongoose';
// import redisClient from './config/redis.js';
// import connectDB from './config/database.js';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import jwt from 'jsonwebtoken';
// import User from './modules/user/user.model.js';
// import ObservabilityService from './modules/monitoring/observability.service.js';
// import { revalidateSocketAuth } from './utils/socketAuth.js';

// // ---------------------------------------------

// // Socket connection tracking for rate limiting
// const socketConnections = new Map(); // IP -> Set of socket IDs
// const MAX_SOCKETS_PER_IP = 5;

// // // Allowed origins for Socket.IO
// // const allowedOrigins = [
// //   'https://dme-frontend.vercel.app',
// //   'https://www.dailymindeducation.com',
// //   'http://localhost:3000',
// //   'http://localhost:5173'
// // ];

// // const PORT = process.env.PORT || 5000;

// // async function startServer() {
// //   try {
// //     // Connect to MongoDB
// //     await connectDB();

// //     // Initialize Redis (Upstash does not require .connect())
// //     try {
// //       if (typeof redisClient.connect === 'function') {
// //         await redisClient.connect();
// //       }
// //       console.log('Redis ready');
// //     } catch (redisError) {
// //       console.warn('Redis unavailable, continuing without Redis:', redisError.message);
// //     }

// //     // Create HTTP server
// //     const server = createServer(app);

// //     // Setup Socket.IO with auth middleware
// //     const io = new Server(server, {
// //       cors: {
// //         origin: function(origin, callback) {
// //           if (!origin || allowedOrigins.includes(origin)) {
// //             callback(null, true);
// //           } else {
// //             callback(new Error('Not allowed by CORS'));
// //           }
// //         },
// //         methods: ["GET", "POST"],
// //         credentials: true
// //       },
// //       pingTimeout: 60000,
// //       pingInterval: 25000,
// //       upgradeTimeout: 10000,
// //       maxHttpBufferSize: 1e6,
// //       allowEIO3: true,
// //       transports: ['websocket', 'polling'],
// //       connectTimeout: 10000,
// //       perMessageDeflate: {
// //         threshold: 1024,
// //         zlibDeflateOptions: { level: 6 }
// //       }
// //     });
// // Allowed origins for Socket.IO
// const allowedOrigins = [
//   'https://dme-frontend.vercel.app',
//   'https://www.dailymindeducation.com',
//   'http://localhost:3000',
//   'http://localhost:5173'
// ];

// // Setup Socket.IO with the CORS configuration
// const io = new Server(server, {
//   cors: {
//     origin: function(origin, callback) {
//       if (!origin || allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error('Not allowed by CORS'));
//       }
//     },
//     methods: ['GET', 'POST'],
//     credentials: true, // Allow credentials (cookies, headers)
//   },
// });



//     // Socket authentication middleware
//     io.use(async (socket, next) => {
//       try {
//         const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
//         if (!token) return next(new Error('Authentication required'));

//         const payload = jwt.verify(token, process.env.JWT_SECRET);
//         const user = await User.findById(payload.uid).select('-passwordHash');
//         if (!user) return next(new Error('Invalid user'));

//         socket.user = user;
//         next();
//       } catch (error) {
//         console.log('Socket auth failed:', error.message);
//         next(new Error('Authentication failed'));
//       }
//     });

//     global.io = io;

//     // Socket.IO connection handling with rate limiting
//     // E2: Rate-limit socket events
//     const socketEventCounts = new Map(); // socketId -> Map<eventType, count>
//     const SOCKET_EVENT_LIMITS = {
//       'join-quiz': 10, // Max 10 join-quiz events per minute
//       'pong': 60, // Max 60 pong events per minute
//       'custom': 20 // Max 20 custom events per minute
//     };

//     io.on('connection', (socket) => {
//       const clientIP = socket.handshake.address;
//       console.log(`User ${socket.user.name} connected from ${clientIP}:`, socket.id);

//       ObservabilityService.recordWebSocketConnection(socket.user._id, 'connect');

//       if (!socketConnections.has(clientIP)) {
//         socketConnections.set(clientIP, new Set());
//       }
//       const ipSockets = socketConnections.get(clientIP);
//       if (ipSockets.size >= MAX_SOCKETS_PER_IP) {
//         console.log(`Connection rejected: IP ${clientIP} has ${ipSockets.size} connections (max: ${MAX_SOCKETS_PER_IP})`);
//         socket.emit('error', { message: 'Too many connections from this IP' });
//         socket.disconnect(true);
//         return;
//       }
//       ipSockets.add(socket.id);

//       // Initialize event counter for this socket
//       socketEventCounts.set(socket.id, new Map());

//       // E1: Enforce quiz room membership - validate quizDate + attempt exists
//       socket.on('join-quiz', async (quizDate) => {
//         try {
//           const authResult = await revalidateSocketAuth(socket);
//           if (!authResult.valid) {
//             console.log(`Socket ${socket.id} token invalid on join-quiz: ${authResult.reason}`);
//             socket.emit('error', { message: 'Session expired. Please reconnect.', code: 'TOKEN_EXPIRED' });
//             socket.disconnect(true);
//             return;
//           }
//           // E2: Rate limit join-quiz events
//           const eventCounts = socketEventCounts.get(socket.id);
//           const joinCount = (eventCounts.get('join-quiz') || 0) + 1;
//           if (joinCount > SOCKET_EVENT_LIMITS['join-quiz']) {
//             console.log(`Rate limit exceeded for join-quiz: socket ${socket.id}`);
//             socket.emit('error', { message: 'Too many join-quiz requests' });
//             return;
//           }
//           eventCounts.set('join-quiz', joinCount);
          
//           // Reset counter after 1 minute
//           setTimeout(() => {
//             const counts = socketEventCounts.get(socket.id);
//             if (counts) counts.set('join-quiz', Math.max(0, (counts.get('join-quiz') || 0) - 1));
//           }, 60000);

//           // E1: Validate quizDate format
//           const quizDatePattern = /^\d{4}-\d{2}-\d{2}$/;
//           if (!quizDatePattern.test(quizDate)) {
//             socket.emit('error', { message: 'Invalid quiz date format' });
//             return;
//           }

//           const QuizAttempt = (await import('./modules/quiz/quizAttempt.model.js')).default;
//           const attempt = await QuizAttempt.findOne({ user: socket.user._id, quizDate });

//           if (!attempt) {
//             socket.emit('error', { message: 'No active quiz attempt found' });
//             return;
//           }
//           if (String(attempt.user) !== String(socket.user._id)) {
//             socket.emit('error', { message: 'Attempt binding mismatch' });
//             return;
//           }

//           socket.join(`quiz-${quizDate}`);
//           console.log(`User ${socket.user.name} joined quiz room: ${quizDate}`);
//         } catch (error) {
//           console.error('Error in join-quiz:', error);
//           socket.emit('error', { message: 'Failed to join quiz room' });
//         }
//       });
      
//       socket.on('leave-quiz', (quizDate) => {
//         socket.leave(`quiz-${quizDate}`);
//         console.log(`User ${socket.user.name} left quiz room: ${quizDate}`);
//       });

//       // Heartbeat
//       const heartbeat = setInterval(() => {
//         socket.emit('ping', Date.now());
//       }, 30000);

//       // E2: Rate-limit pong events + periodic token revalidation
//       socket.on('pong', async (timestamp) => {
//         const authResult = await revalidateSocketAuth(socket);
//         if (!authResult.valid) {
//           console.log(`Socket ${socket.id} token invalid on pong: ${authResult.reason}`);
//           socket.emit('error', { message: 'Session expired. Please reconnect.', code: 'TOKEN_EXPIRED' });
//           socket.disconnect(true);
//           return;
//         }
//         const eventCounts = socketEventCounts.get(socket.id);
//         const pongCount = (eventCounts.get('pong') || 0) + 1;
//         if (pongCount > SOCKET_EVENT_LIMITS['pong']) {
//           console.log(`Rate limit exceeded for pong: socket ${socket.id}`);
//           socket.disconnect(true);
//           return;
//         }
//         eventCounts.set('pong', pongCount);
//         setTimeout(() => {
//           const counts = socketEventCounts.get(socket.id);
//           if (counts) counts.set('pong', Math.max(0, (counts.get('pong') || 0) - 1));
//         }, 60000);
//         socket.latency = Date.now() - timestamp;
//       });

//       socket.on('disconnect', () => {
//         console.log(`User ${socket.user?.name || 'unknown'} disconnected:`, socket.id);
//         ObservabilityService.recordWebSocketConnection(socket.user?._id, 'disconnect');

//         // Cleanup connections
//         const ipSockets = socketConnections.get(clientIP);
//         if (ipSockets) {
//           ipSockets.delete(socket.id);
//           if (ipSockets.size === 0) socketConnections.delete(clientIP);
//         }

//         // Cleanup event counters
//         socketEventCounts.delete(socket.id);

//         clearInterval(heartbeat);
//       });
//     });

//     let httpServer;
//     httpServer = server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`);
//     });

//     const shutdown = async (signal) => {
//       console.log(`${signal} received, shutting down gracefully...`);
//       stopQuizScheduler();
//       stopQuizIntervals();
//       if (httpServer) httpServer.close();
//       await mongoose.connection.close();
//       console.log('Shutdown complete');
//       process.exit(0);
//     };

//     process.on('SIGTERM', () => shutdown('SIGTERM'));
//     process.on('SIGINT', () => shutdown('SIGINT'));

//     startQuizScheduler();
//     await recoverQuizAdvancement();
//   } catch (error) {
//     console.error('Failed to start server:', error);
//     process.exit(1);
//   }
// }

// startServer();
