import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getSubscriptionSummary,
  refreshSubscriptionCycle,
} from "../services/subscriptionService.js";

const router = express.Router();

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
