// utils/sms.js
import fetch from 'node-fetch';

const SMS_API_URL = 'https://2factor.in/API/V1';

export async function sendSMS(phone, otp) {
  const API_KEY = process.env['TWOFACTOR_API_KEY'];
  if (!API_KEY) {
    console.log(`📱 [DEV MODE] SMS not sent. OTP for ${phone}: ${otp}`);
    return 'DEV_MODE_SUCCESS';
  }

  // Format phone number for 2Factor.in API
  // Remove any + or spaces, and ensure it's in international format
  let formattedPhone = phone.replace(/[\+\s-]/g, '');
  // If it's an Indian number without country code, add 91
  if (formattedPhone.length === 10 && /^\d{10}$/.test(formattedPhone)) {
    formattedPhone = '91' + formattedPhone;
  }

  console.log('Sending SMS to formatted phone:', formattedPhone, 'with OTP:', otp);

  // Use the basic SMS OTP endpoint (doesn't require DLT approval)
  // Format: https://2factor.in/API/V1/{API_KEY}/SMS/{PHONE}/{OTP}
  const url = `${SMS_API_URL}/${API_KEY}/SMS/${formattedPhone}/${otp}`;

  try {
    const response = await fetch(url);
    const data = await response.text();

    console.log('2Factor API Response:', data);

    // Check for error responses
    if (data.toLowerCase().includes('error') || data.toLowerCase().includes('invalid')) {
      throw new Error(`SMS API Error: ${data}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw new Error('Failed to send SMS');
  }
}

export async function sendOTP(phone, otp) {
  return sendSMS(phone, otp);
}