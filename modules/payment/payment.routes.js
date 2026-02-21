// modules/payment/payment.routes.js
import express from "express";
import * as Controller from "./payment.controller.js";
import { authRequired, eligibilityRequired } from "../../middlewares/auth.middleware.js";
import { paymentRateLimit, readRateLimit } from "../../middlewares/rate-limit.middleware.js";
import { validate, paymentSchemas } from "../../utils/validation.js";

const router = express.Router();

router.post("/create-order", authRequired, paymentRateLimit, validate(paymentSchemas.createOrder), Controller.createOrder);
router.post("/verify", authRequired, paymentRateLimit, validate(paymentSchemas.verifyPayment), Controller.verify);
router.post("/webhook", Controller.razorpayWebhook); // No auth - comes from Razorpay
router.post("/refund", authRequired, paymentRateLimit, Controller.requestRefund);

router.get("/quiz-status", authRequired, Controller.quizStatus);
router.get("/today-paid-count", readRateLimit, Controller.paidCount);
router.get("/history", authRequired, Controller.getUserPayments);
router.get("/user-payments", authRequired, Controller.getUserPayments);
router.get("/me/eligibility", authRequired, Controller.getUserEligibility);

export default router;
