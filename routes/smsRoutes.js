import express from "express";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import otpGenerator from "otp-generator";
import axios from "axios";

const router = express.Router();

// ✅ Phone validation (Swaziland +268XXXXXXXX)
const validatePhone = (phone) => /^\+268\d{8}$/.test(phone);

// ✅ Generate OTP
const generateOTP = () =>
  otpGenerator.generate(6, {
    upperCaseAlphabets: false,
    specialChars: false,
    lowerCaseAlphabets: false,
  });

// ----------------------------
// 📌 Get MTN Access Token
// ----------------------------
const getMtnAccessToken = async () => {
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
};

// ----------------------------
// 📌 Send OTP SMS
// ----------------------------
const sendOtpSms = async (to, otp) => {
  try {
    const token = await getMtnAccessToken();

    const payload = {
      senderAddress: process.env.MTN_SENDER_ADDRESS,
      receiverAddress: [to],
      message: `Your OTP is ${otp}. It expires in 5 minutes.`,
      clientCorrelator: Date.now().toString(),
      serviceCode: process.env.MTN_SERVICE_CODE,
      keyword: process.env.MTN_KEYWORD,
      requestDeliveryReceipt: false,
    };

    const resApi = await axios.post(process.env.MTN_SMS_URL, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    return { success: true, data: resApi.data };
  } catch (err) {
    console.error("❌ MTN SMS Error:", err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
};

// ----------------------------
// 📌 Send OTP Endpoint
// ----------------------------
router.post("/send-otp", async (req, res) => {
  const { phone } = req.body;

  if (!phone)
    return res.status(400).json({ success: false, error: "Phone required" });

  if (!validatePhone(phone))
    return res.status(400).json({
      success: false,
      error: "Invalid phone format. Use +268XXXXXXXX",
    });

  try {
    // Check resend limit (1 minute)
    const existingUser = await User.findOne({ phone });
    if (
      existingUser &&
      existingUser.lastOtpSent &&
      Date.now() - existingUser.lastOtpSent < 60000
    ) {
      return res
        .status(429)
        .json({ success: false, error: "Please wait 1 minute before requesting a new OTP" });
    }

    const otp = generateOTP();
    console.log("OTP to send to MTN:", otp); // ✅ ye OTP MTN ko jayega
    const hashedOtp = await bcrypt.hash(otp, 10);

    await User.findOneAndUpdate(
      { phone },
      {
        otp: hashedOtp,
        otpExpiry: Date.now() + 5 * 60 * 1000,
        lastOtpSent: Date.now(),
        isPhoneVerified: false,
      },
      { upsert: true, new: true }
    );

    const result = await sendOtpSms(phone, otp);
    if (!result.success)
      return res
        .status(500)
        .json({ success: false, error: result.error || "SMS sending failed" });

    res.json({ success: true, message: "OTP  sent successfully" });
  } catch (err) {
    console.error("Send OTP error:", err.message);
    res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});

// ----------------------------
// 📌 Verify OTP Endpoint
// ----------------------------
router.post("/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp)
    return res
      .status(400)
      .json({ success: false, error: "Phone and OTP required" });

  try {
    const user = await User.findOne({ phone });
    if (!user)
      return res.status(400).json({ success: false, error: "User not found" });

    if (!user.otp || !user.otpExpiry)
      return res.status(400).json({
        success: false,
        error: "No OTP found. Please request again.",
      });

    // Check expiry
    if (user.otpExpiry < Date.now()) {
      user.otp = null;
      user.otpExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, error: "OTP expired" });
    }

    const isMatch = await bcrypt.compare(otp, user.otp);
    if (!isMatch) {
      user.verifyAttempts = (user.verifyAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ success: false, error: "Invalid OTP" });
    }

    // ✅ Success
    user.isPhoneVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    user.verifyAttempts = 0;
    await user.save();

    const token = jwt.sign(
      { id: user._id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    console.log("✅ JWT Token for user:", token); 
    // res.json({ success: true, message: "Phone verified", token });
    res.json({
  success: true,
  message: "Phone verified",
  token,
  user: {
    _id: user._id,
    phone: user.phone,
    // agar chaho, aur fields bhi
  },
});

    
  } catch (err) {
    console.error("Verify OTP error:", err.message);
    res.status(500).json({ success: false, error: "Failed to verify OTP" });
  }
});

export default router;
