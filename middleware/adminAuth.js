import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  DASHBOARD_SIGN_MAX_SKEW_SEC,
  signDashboardRequest,
} from "../utils/dashboardRequestAuth.js";

const usedSignatures = new Map();

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "";
};

const enforceAllowedIps = (req, res) => {
  const allowedIps = (process.env.DASHBOARD_API_ALLOWED_IPS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allowedIps.length) return true;

  const ip = getClientIp(req);
  if (allowedIps.includes(ip)) return true;

  res.status(403).json({ success: false, message: "IP not allowed" });
  return false;
};

const pruneUsedSignatures = (nowSec) => {
  for (const [signature, expiresAt] of usedSignatures) {
    if (expiresAt <= nowSec) usedSignatures.delete(signature);
  }
};

export const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    req.authType = "jwt";
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export const verifyDashboardSignature = (req, res, next) => {
  const configured = process.env.DASHBOARD_API_KEY || "";
  if (!configured) {
    return res.status(503).json({
      success: false,
      message: "Dashboard API key is not configured",
    });
  }

  if (req.headers["x-api-key"]) {
    return res.status(401).json({
      success: false,
      message: "Do not send x-api-key. Sign the request with x-timestamp and x-signature.",
    });
  }

  const timestamp = String(req.headers["x-timestamp"] || "");
  const signature = String(req.headers["x-signature"] || "").toLowerCase();
  if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) {
    return res.status(401).json({
      success: false,
      message: "Invalid or missing request signature",
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const timestampSec = timestamp.length > 10
    ? Math.floor(Number(timestamp) / 1000)
    : Number(timestamp);
  const skew = Math.abs(nowSec - timestampSec);
  const maxSkew = Number(process.env.DASHBOARD_SIGN_MAX_SKEW_SEC || DASHBOARD_SIGN_MAX_SKEW_SEC);

  if (!Number.isFinite(timestampSec) || skew > maxSkew) {
    return res.status(401).json({
      success: false,
      message: "Request signature expired",
    });
  }

  const expected = signDashboardRequest({
    apiKey: configured,
    timestamp: String(timestampSec),
    method: req.method,
    originalUrl: req.originalUrl,
  });

  if (!safeEqual(signature, expected)) {
    return res.status(401).json({
      success: false,
      message: "Invalid or missing request signature",
    });
  }

  pruneUsedSignatures(nowSec);
  if (usedSignatures.has(signature)) {
    return res.status(401).json({
      success: false,
      message: "Request signature already used",
    });
  }
  usedSignatures.set(signature, nowSec + maxSkew);

  if (!enforceAllowedIps(req, res)) return;

  req.authType = "signed";
  return next();
};

export const verifyAdminOrApiKey = (req, res, next) => {
  if (req.headers["x-timestamp"] || req.headers["x-signature"] || req.headers["x-api-key"]) {
    return verifyDashboardSignature(req, res, next);
  }
  return verifyAdminToken(req, res, next);
};
