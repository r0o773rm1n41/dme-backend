// middlewares/auth.middleware.js
import jwt from "jsonwebtoken";
import User from "../modules/user/user.model.js";
import Payment from "../modules/payment/payment.model.js";

export async function authRequired(req, res, next) {
  try {
    const token =
      req.headers.authorization?.split(" ")[1] ||
      req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({ message: "Auth required" });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      // Provide more specific error message for expired tokens
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          message: "Token expired", 
          code: "TOKEN_EXPIRED",
          expiredAt: jwtError.expiredAt 
        });
      }
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Support string _id values (seeded IDs) by querying directly
    // Primary strategy: use phone if available (most reliable)
    let user = null;
    if (payload.phone) {
      // normalize phone (may come as 10-digit or with 91 prefix)
      let phone = payload.phone.replace(/[^0-9]/g, '');
      if (phone.length === 10) phone = '91' + phone;
      user = await User.findOne({ phone }).select("-passwordHash");
    }
    
    // Fallback: try uid if phone lookup failed (for backward compatibility)
    if (!user && payload.uid && payload.uid !== 'undefined') {
      user = await User.findOne({ _id: payload.uid }).select("-passwordHash");
    }
    
    if (!user) {
      return res.status(401).json({ message: "Invalid user" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function roleRequired(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Auth required" });
    }

    const roleHierarchy = {
      'SUPER_ADMIN': 3,
      'QUIZ_ADMIN': 2,
      'CONTENT_ADMIN': 2,
      'USER': 1
    };

    const userRoleLevel = roleHierarchy[req.user.role] || 0;
    const requiredRoleLevel = Math.max(...roles.map(role => roleHierarchy[role] || 0));

    if (userRoleLevel < requiredRoleLevel) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
}

export function mutateAudit(req, before, after) {
  req._auditBefore = before;
  req._auditAfter = after;
}

export async function eligibilityRequired(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Auth required" });
    }

    // Check if user is eligible for today's quiz
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const payment = await Payment.findOne({
      user: req.user._id,
      quizDate: today,
      status: "SUCCESS"
    });

    if (!payment) {
      return res.status(403).json({ message: "Payment required for quiz participation" });
    }

    req.user.isEligible = true;
    next();
  } catch (err) {
    return res.status(500).json({ message: "Eligibility check failed" });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function requirePaidUser(req, res, next) {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const payment = await Payment.findOne({
      user: req.user._id,
      quizDate: today,
      status: "SUCCESS"
    });

    if (!payment) {
      return res.status(403).json({ message: "Payment required" });
    }

    req.user.isEligible = true;
    next();
  } catch (err) {
    return res.status(500).json({ message: "Eligibility check failed" });
  }
}
