import express from "express";
import jwt from "jsonwebtoken";
import { protect } from "../middleware/authMiddleware.js";
import { INITIAL_OFFER_CODE } from "../config/cgwconfig.js";
import { MtnUnsubscribeError } from "../utils/mtnUnsubscribe.js";
import {
  activateSubscriptionByMsisdn,
  getSubscriptionSummary,
  refreshSubscriptionCycle,
  unsubscribeUser,
} from "../services/subscriptionService.js";

const router = express.Router();

const isLocalSubscriptionEnabled = () =>
  process.env.ENABLE_LOCAL_SUBSCRIPTION === "true";

const createToken = (user) =>
  jwt.sign(
    { id: user._id, tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

router.post("/dev-activate", async (req, res) => {
  if (!isLocalSubscriptionEnabled()) {
    return res.status(404).json({
      success: false,
      message: "Local subscription bypass is disabled",
    });
  }

  try {
    const msisdn = req.body?.msisdn || req.body?.phone || req.body?.mobileNumber;
    const offerCode = req.body?.offerCode || INITIAL_OFFER_CODE;
    const user = await activateSubscriptionByMsisdn(msisdn);
    const token = createToken(user);

    return res.json({
      success: true,
      token,
      offerCode,
      msisdn: user.phone,
      subscription: getSubscriptionSummary(user),
    });
  } catch (error) {
    console.error("Local subscription activate error:", error.message);
    return res.status(400).json({
      success: false,
      message: error.message || "Unable to activate subscription locally",
    });
  }
});

router.post("/unsubscribe", protect, async (req, res) => {
  try {
    const result = await unsubscribeUser(req.user);
    const mtn = result.mtn || {};
    return res.json({
      success: true,
      message: mtn.status || "Unsubscribe successful",
      description: mtn.description || "Your number has been unsubscribed. Please subscribe again to play.",
      msisdn: result.msisdn,
      mtn,
      subscription: result.subscription,
    });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    if (error instanceof MtnUnsubscribeError) {
      return res.status(error.statusCode || 502).json({
        success: false,
        message: error.message,
        description: error.mtn?.description || error.message,
        mtn: error.mtn,
      });
    }
    return res.status(500).json({
      success: false,
      message: "Unable to unsubscribe right now. Please try again.",
    });
  }
});

router.get("/status", protect, async (req, res) => {
  try {
    await refreshSubscriptionCycle(req.user);
    return res.json({
      success: true,
      subscription: getSubscriptionSummary(req.user),
    });
  } catch (error) {
    console.error("Subscription status error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load subscription status",
    });
  }
});

export default router;
