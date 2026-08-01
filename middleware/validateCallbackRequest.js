import crypto from "crypto";

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const getProvidedSecret = (req) => {
  const authorization = req.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  return (
    req.headers["x-callback-secret"] ||
    req.headers["x-sdp-callback-secret"] ||
    bearer
  );
};

export const validateCallbackRequest = (req, res, next) => {
  const configuredSecret = process.env.SDP_CALLBACK_SECRET;
  const allowedIps = String(process.env.SDP_CALLBACK_ALLOWED_IPS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const forwardedIp = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const requestIp = forwardedIp || req.socket.remoteAddress || "";

  if (allowedIps.length && !allowedIps.includes(requestIp)) {
    console.warn("[SDP CALLBACK REJECTED] IP:", requestIp);
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  if (configuredSecret && !safeEqual(getProvidedSecret(req), configuredSecret)) {
    console.warn("[SDP CALLBACK REJECTED] Invalid signature/secret");
    return res.status(401).json({ success: false, message: "Invalid callback credentials" });
  }

  const hasPayload =
    Object.keys(req.query || {}).length > 0 ||
    (req.body && Object.keys(req.body).length > 0);

  if (!hasPayload) {
    return res.status(400).json({ success: false, message: "Callback payload is required" });
  }

  if (!configuredSecret && !allowedIps.length) {
    console.warn(
      "[SDP CALLBACK SECURITY] Configure SDP_CALLBACK_SECRET or SDP_CALLBACK_ALLOWED_IPS in production."
    );
  }

  next();
};
