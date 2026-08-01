import axios from "axios";

/**
 * Get MTN OAuth2 access token
 */
export async function getMtnAccessToken() {
  try {
    const response = await axios.post(
      process.env.MTN_TOKEN_URL,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              process.env.MTN_CLIENT_ID + ":" + process.env.MTN_CLIENT_SECRET
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data.access_token;
  } catch (err) {
    console.error("❌ MTN Token Error:", err.response?.data || err.message);
    throw new Error("Failed to get MTN access token");
  }
}

/**
 * Send OTP SMS via MTN
 * @param {string} to - Phone number in +268XXXXXXXX format
 * @param {string} otp - One-time password
 */
export async function sendOtpSms(to, otp) {
  try {
    const token = await getMtnAccessToken();
    console.log(token);
    const resApi = await axios.post(
      process.env.MTN_SMS_URL,
      {
        from: process.env.MTN_SENDER_ADDRESS,
        to,
        message: `Your OTP is ${otp}. It expires in 5 minutes.`,
        serviceCode: process.env.MTN_SERVICE_CODE,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ MTN SMS Sent:", resApi.data);
    return { success: true, data: resApi.data };
  } catch (err) {
    console.error("❌ MTN SMS Error:", err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}
