import crypto from "crypto";

export const DASHBOARD_SIGN_MAX_SKEW_SEC = 60;

export const buildDashboardSignPayload = (timestamp, method, originalUrl) =>
  `${timestamp}\n${String(method || "GET").toUpperCase()}\n${originalUrl}`;

export const signDashboardRequest = ({
  apiKey,
  timestamp,
  method,
  originalUrl,
}) =>
  crypto
    .createHmac("sha256", apiKey)
    .update(buildDashboardSignPayload(timestamp, method, originalUrl))
    .digest("hex");
