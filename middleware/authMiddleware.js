import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { logUnsubscribe } from "../utils/unsubscribeLog.js";

export const protect = async (req, res, next) => {
  const isUnsubscribe = String(req.originalUrl || "").includes("unsubscribe");
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    if (isUnsubscribe) {
      logUnsubscribe("auth-failed", { reason: "TOKEN_REQUIRED" });
    }
    return res.status(401).json({
      success: false,
      code: "TOKEN_REQUIRED",
      message: "Not authorized, no token",
    });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      if (isUnsubscribe) {
        logUnsubscribe("auth-failed", { reason: "USER_NOT_FOUND" });
      }
      return res.status(401).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Session user no longer exists. Please subscribe again.",
      });
    }

    const tokenVersion = Number(decoded.tokenVersion ?? 0);
    const currentVersion = Number(user.tokenVersion ?? 0);
    if (tokenVersion !== currentVersion) {
      if (isUnsubscribe) {
        logUnsubscribe("auth-failed", { reason: "TOKEN_REVOKED", phone: user.phone });
      }
      return res.status(401).json({
        success: false,
        code: "TOKEN_REVOKED",
        message: "Session expired. Please subscribe again.",
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (isUnsubscribe) {
      logUnsubscribe("auth-failed", { reason: "INVALID_TOKEN", error: error.message });
    }
    return res.status(401).json({
      success: false,
      code: "INVALID_TOKEN",
      message: "Not authorized, token failed",
    });
  }
};
