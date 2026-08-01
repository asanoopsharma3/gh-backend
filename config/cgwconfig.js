import dotenv from "dotenv";

dotenv.config();

export const ENV =
  process.env.CGW_ENV || (process.env.NODE_ENV === "production" ? "production" : "staging");

export const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:5174";
export const CALLBACK_URL = process.env.CGW_CALLBACK_URL || `${FRONTEND_BASE_URL}/api/callback`;
export const HE_REDIRECT_URL = process.env.CGW_HE_REDIRECT_URL || CALLBACK_URL;
export const OFFER_CODE = process.env.CGW_OFFER_CODE || "9923310010";
export const INITIAL_OFFER_CODE = process.env.CGW_INITIAL_OFFER_CODE || OFFER_CODE;
export const HE_FIXED_MOBILE_NUMBER =
  process.env.CGW_HE_MOBILE_NUMBER ||
  process.env.CGW_HE_FIXED_MOBILE_NUMBER ||
  "99999999999";

const defaultHeBaseUrl =
  process.env.CGW_HE_BASE_URL || "https://cgw.mtn.com.gh/cgw-web/cgw/redirect/he";
const defaultNonHeBaseUrl =
  process.env.CGW_NON_HE_BASE_URL || "https://cgw.mtn.com.gh/cgw-web/cgw/redirect/nhe";

export const CGW_CONFIG = {
  staging: {
    he: { baseUrl: defaultHeBaseUrl },
    nonHe: { baseUrl: defaultNonHeBaseUrl },
  },
  production: {
    he: { baseUrl: defaultHeBaseUrl },
    nonHe: { baseUrl: defaultNonHeBaseUrl },
  },
};

export const normalizeMsisdn = (value) => {
  if (!value) return null;

  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return `233${digits.slice(1)}`;

  return `233${digits}`;
};

export const generateFixedHEUrl = ({
  offerCode = OFFER_CODE,
  redirectUrl = HE_REDIRECT_URL,
  mobileNumber = HE_FIXED_MOBILE_NUMBER,
} = {}) => {
  const params = new URLSearchParams({
    OfferCode: offerCode,
    redirectUrl,
    mobileNumber,
  });

  return `${CGW_CONFIG[ENV].he.baseUrl}?${params.toString()}`;
};

export const generateCGWUrl = (
  msisdn,
  isHeaderEnrichment = true,
  offerCode = OFFER_CODE,
  redirectUrl = CALLBACK_URL
) => {
  const config = CGW_CONFIG[ENV];
  const baseUrl = isHeaderEnrichment ? config.he.baseUrl : config.nonHe.baseUrl;

  const params = new URLSearchParams({
    OfferCode: offerCode,
    redirectUrl,
  });

  if (isHeaderEnrichment) {
    params.append("mobileNumber", msisdn || HE_FIXED_MOBILE_NUMBER);
  }

  if (!isHeaderEnrichment && msisdn) {
    params.append("mobileNumber", msisdn);
  }

  return `${baseUrl}?${params.toString()}`;
};

const firstDefinedValue = (payload, keys) => {
  for (const key of keys) {
    const value = payload?.[key];
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== "" &&
      String(value).trim().toLowerCase() !== "undefined"
    ) {
      return value;
    }
  }
  return undefined;
};

export const parseCGWCallback = (payload) => ({
  msisdn: firstDefinedValue(payload, [
    "msisdn",
    "MSISDN",
    "mobileNumber",
    "MobileNumber",
    "ani",
  ]),
  status: firstDefinedValue(payload, [
    "status",
    "Status",
    "result",
    "Result",
    "billingStatus",
    "BillingStatus",
    "resultCode",
  ]),
  offerId: firstDefinedValue(payload, ["offerId", "OfferId", "OfferCode", "offerCode"]),
  cgid: firstDefinedValue(payload, ["cgid", "CGID", "cgId"]),
});

export const mapCGWStatus = (statusCode) => {
  const normalizedStatus = String(statusCode ?? "").trim().toLowerCase();

  const statusMap = {
    200: { subscriptionStatus: "active", success: true, message: "Success" },
    0: { subscriptionStatus: "active", success: true, message: "Success" },
    "00": { subscriptionStatus: "active", success: true, message: "Success" },
    ok: { subscriptionStatus: "active", success: true, message: "Success" },
    active: { subscriptionStatus: "active", success: true, message: "Success" },
    activated: { subscriptionStatus: "active", success: true, message: "Success" },
    success: { subscriptionStatus: "active", success: true, message: "Success" },
    successful: { subscriptionStatus: "active", success: true, message: "Success" },
    succuss: { subscriptionStatus: "active", success: true, message: "Success" },
    1: { subscriptionStatus: "deactivated", success: false, message: "Activation failed" },
    112: { subscriptionStatus: "suspended", success: false, message: "Subscription in progress" },
    11: { subscriptionStatus: "deactivated", success: false, message: "No consent" },
    12: { subscriptionStatus: "deactivated", success: false, message: "Invalid Consent" },
    13: { subscriptionStatus: "deactivated", success: false, message: "Error consent" },
    2: { subscriptionStatus: "deactivated", success: false, message: "Low balance" },
    63: { subscriptionStatus: "deactivated", success: false, message: "Low balance" },
    29: { subscriptionStatus: "deactivated", success: false, message: "Low balance" },
    26: { subscriptionStatus: "deactivated", success: false, message: "Low balance" },
  };

  return (
    statusMap[statusCode] ||
    statusMap[normalizedStatus] ||
    {
      subscriptionStatus: "deactivated",
      success: false,
      message: normalizedStatus
        ? `Unknown status code: ${statusCode}`
        : "The payment provider did not return a billing status. Please contact support if airtime was deducted.",
    }
  );
};
