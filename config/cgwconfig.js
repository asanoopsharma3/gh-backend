import dotenv from "dotenv";

dotenv.config();

export const ENV =
  process.env.CGW_ENV || (process.env.NODE_ENV === "production" ? "production" : "staging");

export const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:5174";
export const CALLBACK_URL = process.env.CGW_CALLBACK_URL || `${FRONTEND_BASE_URL}/api/callback`;
export const HE_REDIRECT_URL = process.env.CGW_HE_REDIRECT_URL || CALLBACK_URL;
export const OFFER_CODE = process.env.CGW_OFFER_CODE || "9923310010";
export const INITIAL_OFFER_CODE = process.env.CGW_INITIAL_OFFER_CODE || OFFER_CODE;
export const TOPUP_OFFER_CODE = process.env.CGW_TOPUP_OFFER_CODE || "9923310009";
const toCatalogGhs = (value, fallback = 1) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (numeric >= 50) return Number((numeric / 100).toFixed(2));
  return Number(numeric.toFixed(2));
};

export const DAILY_PLAN_AMOUNT_GHS = toCatalogGhs(process.env.CGW_DAILY_AMOUNT_GHS || 1, 1);
export const TOPUP_PLAN_AMOUNT_GHS = toCatalogGhs(process.env.CGW_TOPUP_AMOUNT_GHS || 1, 1);

export const OFFER_CATALOG = {
  [INITIAL_OFFER_CODE]: {
    code: INITIAL_OFFER_CODE,
    name: "Daily Subscription",
    amountGhs: DAILY_PLAN_AMOUNT_GHS,
    billing: "daily",
  },
  [TOPUP_OFFER_CODE]: {
    code: TOPUP_OFFER_CODE,
    name: "Daily Top-up",
    amountGhs: TOPUP_PLAN_AMOUNT_GHS,
    billing: "one-time",
  },
};

export const getOfferPlan = (offerCode) => {
  const code = String(offerCode || INITIAL_OFFER_CODE).trim() || INITIAL_OFFER_CODE;
  return (
    OFFER_CATALOG[code] || {
      code,
      name: code === INITIAL_OFFER_CODE ? "Daily Subscription" : "Other Plan",
      amountGhs: OFFER_CATALOG[INITIAL_OFFER_CODE]?.amountGhs || 1,
      billing: "unknown",
    }
  );
};

export const parseChargeAmountGhs = (...values) => {
  for (const value of values.flat(1)) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    // MTN sometimes sends pesewas (100 = GHC 1.00). Daily/top-up is GHC 1.
    if (numeric >= 50) return Number((numeric / 100).toFixed(2));
    return Number(numeric.toFixed(2));
  }
  return 0;
};

export const resolvePriceGhs = ({ billedAmount, offerCode, billable = true } = {}) => {
  const billed = parseChargeAmountGhs(billedAmount);
  if (billed > 0) {
    return { priceGhs: billed, priceSource: "billed" };
  }
  if (!billable) {
    return { priceGhs: 0, priceSource: "none" };
  }
  const catalogAmount = Number(getOfferPlan(offerCode).amountGhs || 0);
  return {
    priceGhs: catalogAmount,
    priceSource: catalogAmount > 0 ? "catalog" : "none",
  };
};

export const normalizeConsentFlow = (...values) => {
  for (const value of values) {
    const token = String(value || "")
      .toUpperCase()
      .split(/[?&/\s]/)[0]
      .trim();
    if (token === "HE" || token === "NHE") return token;
    if (token === "LOCAL" || token === "WEB") return token;
    if (token === "SDP") return "SDP";
  }
  return "UNKNOWN";
};
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

const mapStatusCodes = (codes, result) =>
  Object.fromEntries(codes.flatMap((code) => [[code, result], [String(code).toLowerCase(), result]]));

export const mapCGWStatus = (statusCode) => {
  const normalizedStatus = String(statusCode ?? "").trim().toLowerCase();
  const compactStatus = normalizedStatus.replace(/[\s_-]+/g, "");
  const alreadySubscribed =
    compactStatus.includes("alreadysubscrib") ||
    (normalizedStatus.includes("already") && normalizedStatus.includes("subscrib"));

  const successResult = { subscriptionStatus: "active", success: true, message: "Success" };
  const alreadySubscribedResult = {
    subscriptionStatus: "active",
    success: true,
    message: "Already subscribed",
  };
  const lowBalanceResult = {
    subscriptionStatus: "deactivated",
    success: false,
    message: "Low balance",
  };
  const invalidOtpResult = {
    subscriptionStatus: "deactivated",
    success: false,
    message: "Invalid OTP",
  };

  // MTN Ghana CGW transition guide status codes
  const statusMap = {
    ...mapStatusCodes([200], successResult),
    ...mapStatusCodes([9, 115], alreadySubscribedResult),
    ...mapStatusCodes([1], { subscriptionStatus: "deactivated", success: false, message: "Activation failed" }),
    ...mapStatusCodes([112], { subscriptionStatus: "suspended", success: false, message: "Subscription in progress" }),
    ...mapStatusCodes([11], { subscriptionStatus: "deactivated", success: false, message: "No consent" }),
    ...mapStatusCodes([12], { subscriptionStatus: "deactivated", success: false, message: "Invalid Consent" }),
    ...mapStatusCodes([13], { subscriptionStatus: "deactivated", success: false, message: "Error consent" }),
    ...mapStatusCodes([2, 63, 29, 26, 55, 111], lowBalanceResult),
    ...mapStatusCodes([644], {
      subscriptionStatus: "deactivated",
      success: false,
      message: "Failed duplicate subscription",
    }),
    ...mapStatusCodes([91, 186], invalidOtpResult),
    0: successResult,
    "00": successResult,
    ok: successResult,
    active: successResult,
    activated: successResult,
    success: successResult,
    successful: successResult,
    succuss: successResult,
    alreadysubscribedcase: alreadySubscribedResult,
    "already subscribed": alreadySubscribedResult,
    "already subscribe": alreadySubscribedResult,
    alreadysubscribed: alreadySubscribedResult,
    already_subscribed: alreadySubscribedResult,
  };

  if (alreadySubscribed) {
    return alreadySubscribedResult;
  }

  return (
    statusMap[statusCode] ||
    statusMap[normalizedStatus] ||
    statusMap[compactStatus] ||
    {
      subscriptionStatus: "deactivated",
      success: false,
      message: normalizedStatus
        ? `Unknown status code: ${statusCode}`
        : "The payment provider did not return a billing status. Please contact support if airtime was deducted.",
    }
  );
};
