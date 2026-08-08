import express from "express";
import jwt from "jsonwebtoken";
import { protect } from "../middleware/authMiddleware.js";
import { INITIAL_OFFER_CODE } from "../config/cgwconfig.js";
import {
  activateSubscriptionByMsisdn,
  getSubscriptionSummary,
  refreshSubscriptionCycle,
} from "../services/subscriptionService.js";

const router = express.Router();

const isLocalSubscriptionEnabled = () =>
  process.env.ENABLE_LOCAL_SUBSCRIPTION === "true";

const createToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

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
    const token = createToken(user._id);

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
