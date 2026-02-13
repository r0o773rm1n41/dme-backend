// modules/payment/razorpay.service.js
import Razorpay from "razorpay";
import crypto from "crypto";

let razorpayClient = null;
export const razorpayEnabled = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

function getRazorpayClient() {
  if (razorpayClient) return razorpayClient;
  if (!razorpayEnabled) {
    console.warn('Razorpay keys not configured - payments disabled in this environment');
    return null;
  }

  razorpayClient = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  return razorpayClient;
}

export async function createRazorpayOrder(amount, currency = 'INR', receipt = undefined) {
  const client = getRazorpayClient();
  if (!client) {
    // Return a mock order for development/tests
    return { id: `mock_order_${Date.now()}`, amount, currency, receipt, status: 'created' };
  }

  return client.orders.create({ amount, currency, receipt });
}

export function verifyWebhookSignature(body, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Razorpay webhook secret not configured');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return expected === signature;
}
