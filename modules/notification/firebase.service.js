// modules/notification/firebase.service.js
import admin from 'firebase-admin';
import fs from 'fs';

let firebaseApp = null;

function initializeFirebase() {
  if (firebaseApp) return firebaseApp;

  try {
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const jsonStr = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(jsonStr);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
      // Use individual config values
      serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
        token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
      };
    } else {
      console.warn('Firebase service account not provided - push notifications will be disabled');
      return null;
    }

    // Normalize private key newlines if present
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID,
    });

    console.log('Firebase initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.warn('Firebase initialization failed:', error.message);
    return null;
  }
}

export async function sendPushNotification(token, title, body, data = {}) {
  try {
    const app = initializeFirebase();
    if (!app) {
      console.warn('Firebase not initialized, skipping push notification');
      return false;
    }

    const message = {
      token,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log('Push notification sent successfully:', response);
    return true;
  } catch (error) {
    console.error('Failed to send push notification:', error);
    return false;
  }
}

export async function sendMulticastNotification(tokens, title, body, data = {}) {
  try {
    const app = initializeFirebase();
    if (!app) {
      console.warn('Firebase not initialized, skipping multicast push notification');
      return { success: 0, failure: tokens.length };
    }

    const message = {
      tokens,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log(`Multicast notification sent: ${response.successCount} success, ${response.failureCount} failures`);
    return { success: response.successCount, failure: response.failureCount };
  } catch (error) {
    console.error('Failed to send multicast push notification:', error);
    return { success: 0, failure: tokens.length };
  }
}

export { initializeFirebase };