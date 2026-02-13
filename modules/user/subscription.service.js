// modules/user/subscription.service.js
import User from './user.model.js';
import Payment from '../payment/payment.model.js';

export const SUBSCRIPTION_TIERS = {
  FREE: {
    name: 'Free',
    price: 0,
    features: ['Basic quizzes', 'Limited streaks']
  },
  BASIC: {
    name: 'Basic',
    price: 99, // ₹99/month
    features: ['All quiz tiers', 'Streak rewards', 'Referral bonuses', 'Priority support']
  },
  PREMIUM: {
    name: 'Premium',
    price: 199, // ₹199/month
    features: ['All Basic features', 'Exclusive content', 'Advanced analytics', 'VIP support']
  }
};

export async function createSubscription(userId, tier, paymentId) {
  try {
    const tierInfo = SUBSCRIPTION_TIERS[tier];
    if (!tierInfo) {
      throw new Error('Invalid subscription tier');
    }

    // Calculate expiration (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Update user subscription
    await User.findByIdAndUpdate(userId, {
      subscriptionTier: tier,
      subscriptionExpiresAt: expiresAt
    });

    // Log the subscription purchase
    console.log(`User ${userId} subscribed to ${tier} tier until ${expiresAt}`);

    return {
      success: true,
      tier,
      expiresAt,
      features: tierInfo.features
    };
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
}

export async function renewSubscription(userId) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.subscriptionTier || user.subscriptionTier === 'FREE') {
      throw new Error('No active subscription to renew');
    }

    const tierInfo = SUBSCRIPTION_TIERS[user.subscriptionTier];
    const newExpiresAt = new Date(user.subscriptionExpiresAt || new Date());
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    await User.findByIdAndUpdate(userId, {
      subscriptionExpiresAt: newExpiresAt
    });

    return {
      success: true,
      tier: user.subscriptionTier,
      expiresAt: newExpiresAt
    };
  } catch (error) {
    console.error('Error renewing subscription:', error);
    throw error;
  }
}

export async function cancelSubscription(userId) {
  try {
    const user = await User.findById(userId);
    if (!user || user.subscriptionTier === 'FREE') {
      return { success: true, message: 'No active subscription to cancel' };
    }

    // Downgrade to free but keep expiration date for grace period
    await User.findByIdAndUpdate(userId, {
      subscriptionTier: 'FREE'
    });

    return { success: true, message: 'Subscription cancelled, downgraded to free tier' };
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    throw error;
  }
}

export async function getSubscriptionStatus(userId) {
  try {
    const user = await User.findById(userId).select('subscriptionTier subscriptionExpiresAt');
    if (!user) return null;

    const tierInfo = SUBSCRIPTION_TIERS[user.subscriptionTier] || SUBSCRIPTION_TIERS.FREE;
    const isExpired = user.subscriptionExpiresAt && new Date() > user.subscriptionExpiresAt;

    return {
      tier: user.subscriptionTier,
      expiresAt: user.subscriptionExpiresAt,
      isActive: user.subscriptionTier !== 'FREE' && !isExpired,
      isExpired,
      features: tierInfo.features,
      price: tierInfo.price
    };
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return null;
  }
}

export async function processSubscriptionPayment(userId, tier, amount) {
  try {
    // Verify payment amount matches tier price
    const tierInfo = SUBSCRIPTION_TIERS[tier];
    if (!tierInfo || tierInfo.price !== amount) {
      throw new Error('Payment amount does not match subscription price');
    }

    // Create subscription
    const result = await createSubscription(userId, tier, null); // paymentId can be added later

    return result;
  } catch (error) {
    console.error('Error processing subscription payment:', error);
    throw error;
  }
}