import jwt from "jsonwebtoken";
import User from "../models/User.js";
import {
  CALLBACK_URL,
  FRONTEND_BASE_URL,
  HE_FIXED_MOBILE_NUMBER,
  HE_REDIRECT_URL,
  INITIAL_OFFER_CODE,
  OFFER_CODE,
  generateCGWUrl,
  generateFixedHEUrl,
  mapCGWStatus,
  normalizeMsisdn,
  parseCGWCallback,
} from "../config/cgwconfig.js";
import { SUBSCRIPTION_CYCLE_MS } from "../services/subscriptionService.js";
import CGWCallbackLog from "../models/CGWCallbackLog.js";
import CGWCallback from "../models/CGWCallback.js";
import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import MsisdnLog from "../models/MsisdnLog.js";
import SDPCallback from "../models/SDPCallback.js";
import SDPLog from "../models/SDPLog.js";

const createToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

const getRequestMsisdn = (req) =>
  req.msisdn ||
  req.headers.msisdn ||
  req.headers["x-msisdn"] ||
  req.headers["x-up-calling-line-id"];

const getClientMeta = (req) => ({
  ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  userAgent: req.headers["user-agent"],
});

const detectFlow = (req) => {
  const source = String(req.query.flow || req.body?.flow || req.query.source || req.body?.source || "").toUpperCase();
  if (source === "HE" || source === "NHE") return source;
  if (req.query.mobileNumber || req.body?.mobileNumber) return "NHE";
  return "UNKNOWN";
};

const isSdpSuccessStatus = (status, lifecycle = "") => {
  const statusText = String(status || "").toLowerCase();
  const lifecycleText = String(lifecycle || "").toLowerCase();
  if (lifecycleText.includes("unsub")) return false;
  return ["success", "successful", "active", "a", "200", "9", "115"].includes(statusText);
};

const applySubscriptionStatus = async (msisdn, status, lifecycle = "", offerCode = "") => {
  if (!msisdn) return null;

  const normalized = String(status || "").toUpperCase();
  const normalizedLifecycle = String(lifecycle || "").toUpperCase();
  const statusMapping = mapCGWStatus(status, { offerCode });
  const isBillingSuccess = statusMapping.success || isSdpSuccessStatus(status, lifecycle);
  const isTopupBillingSuccess =
    isBillingSuccess &&
    Boolean(offerCode) &&
    String(offerCode) !== String(INITIAL_OFFER_CODE);

  const phone = `+${msisdn}`;
  let user = await User.findOne({ $or: [{ phone }, { phone: msisdn }] });
  if (!user) {
    user = await User.create({ phone });
  }

  if (isBillingSuccess) {
    user.subscriptionStatus = "active";
    user.isAttemptQuiz = false;
    if (isTopupBillingSuccess) {
      user.questionsPlayedToday = 0;
    } else if (!user.subscriptionStartTime) {
      user.subscriptionStartTime = new Date();
      user.nextPlayTime = new Date(Date.now() + SUBSCRIPTION_CYCLE_MS);
    }
    await user.save();
    return user;
  }

  const isSuspended = ["S", "SUSPENDED", "112"].includes(normalized);
  const isUnsubscribed =
    normalizedLifecycle.includes("UNSUB") ||
    ["D", "DEACTIVE", "DEACTIVATED", "INACTIVE", "UNSUB", "UNSUBSCRIBED"].includes(
      normalized
    );

  user.subscriptionStatus = isSuspended && !isUnsubscribed ? "suspended" : "inactive";
  user.isAttemptQuiz = true;
  user.questionsPlayedToday = 0;
  await user.save();

  return user;
};

const getPayloadValue = (payload, keys) => {
  for (const key of keys) {
    if (payload?.[key] !== undefined && payload?.[key] !== null) {
      return payload[key];
    }
  }
  return null;
};

const getSdpValue = (items, names) => {
  const lookupNames = names.map((name) => String(name).toLowerCase());
  return (
    items.find((item) => lookupNames.includes(String(item.name || "").toLowerCase()))
      ?.value || ""
  );
};

const normalizeSdpStatus = (status = "", lifecycle = "", reason = "") => {
  const statusText = String(status).toUpperCase();
  const lifecycleText = String(lifecycle).toUpperCase();
  const reasonText = String(reason).toLowerCase();

  if (lifecycleText.includes("REN") || reasonText.includes("renew")) return "renewal";
  if (
    reasonText.includes("insufficient") ||
    reasonText.includes("low balance") ||
    ["2", "26", "29", "55", "63", "111", "G"].includes(statusText)
  ) {
    return "churn";
  }
  if (["D", "S", "INACTIVE", "SUSPENDED", "UNSUB", "UNSUBSCRIBED"].includes(statusText)) {
    return "failed";
  }
  return statusText ? "failed" : "unknown";
};

export const startHeaderEnrichmentRedirect = async (req, res) => {
  try {
    const offerCode = req.query.offerCode || req.body?.offerCode || OFFER_CODE;
    const redirectUrl = req.query.redirectUrl || req.body?.redirectUrl || HE_REDIRECT_URL;
    const mobileNumber =
      req.query.mobileNumber || req.body?.mobileNumber || HE_FIXED_MOBILE_NUMBER;

    await MsisdnLog.create({
      msisdn: mobileNumber,
      source: "HE_REDIRECT",
      offerCode,
      ...getClientMeta(req),
    }).catch(() => {});

    return res.redirect(generateFixedHEUrl({ offerCode, redirectUrl, mobileNumber }));
  } catch (error) {
    console.error("HE redirect error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error starting HE redirect",
      error: error.message,
    });
  }
};

export const generateCGWRedirectUrl = async (req, res) => {
  try {
    const msisdnFromHeader = getRequestMsisdn(req);
    const msisdnFromBody =
      req.body?.msisdn ||
      req.query?.msisdn ||
      req.body?.mobileNumber ||
      req.query?.mobileNumber;
    const msisdn = normalizeMsisdn(msisdnFromHeader || msisdnFromBody);
    const isHeaderEnrichment = Boolean(msisdnFromHeader);
    const offerCode = req.query?.offerCode || req.body?.offerCode || OFFER_CODE;
    const redirectUrl = req.query?.redirectUrl || req.body?.redirectUrl || CALLBACK_URL;

    if (!msisdnFromHeader && !msisdnFromBody) {
      return res.redirect(`${FRONTEND_BASE_URL}/subscribe?fallback=true&offerCode=${offerCode}`);
    }

    if (!msisdn || !msisdn.startsWith("233") || msisdn.length < 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid MSISDN format. Expected format: 233XXXXXXXXX",
      });
    }

    await MsisdnLog.create({
      msisdn,
      source: isHeaderEnrichment ? "HE" : "NHE",
      offerCode,
      ...getClientMeta(req),
    }).catch(() => {});

    return res.redirect(generateCGWUrl(msisdn, isHeaderEnrichment, offerCode, redirectUrl));
  } catch (error) {
    console.error("Generate CGW URL Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error generating Consent Gateway URL",
      error: error.message,
    });
  }
};

export const activateCGWSubscription = generateCGWRedirectUrl;

export const handleCGWCallback = async (req, res) => {
  try {
    const sdpData = req.body?.requestParam?.data;

    if (Array.isArray(sdpData) && sdpData.length > 0) {
      const msisdn = normalizeMsisdn(getSdpValue(sdpData, ["Msisdn", "MSISDN"]));
      const status = getSdpValue(sdpData, ["SubscriptionStatus"]);
      const offerCode = getSdpValue(sdpData, ["OfferCode"]);
      const lifecycle = getSdpValue(sdpData, ["SubscriberLifeCycle", "SubscriberLifecycle"]);
      const reason = getSdpValue(sdpData, ["Reason", "ResultMessage", "Message"]);
      const chargeAmount = Number(getSdpValue(sdpData, ["ChargeAmount", "ChargingAmount", "Amount"]) || 0);
      const nextBillingDate = getSdpValue(sdpData, ["NextBillingDate"]);
      const transactionId =
        getSdpValue(sdpData, ["TransactionId", "TransactionID", "SequenceNo", "RequestNo"]) ||
        getPayloadValue(req.body, ["transactionId", "transactionID", "sequenceNo", "requestNo"]);
      const operator =
        getSdpValue(sdpData, ["Operator", "Network"]) ||
        getPayloadValue(req.body, ["operator", "network"]) ||
        "MTN Ghana";
      const normalizedStatus = normalizeSdpStatus(status, lifecycle, reason);

      console.log("SDP CALLBACK DATA:");
      console.log(JSON.stringify(req.body, null, 2));

      const sdpPayload = {
        type: "SDP",
        method: req.method,
        externalServiceId: req.body.externalServiceId,
        requestId: req.body.requestId,
        requestTimeStamp: req.body.requestTimeStamp,
        channel: req.body.channel,
        featureId: req.body.featureId,
        planId: req.body.requestParam?.planId,
        command: req.body.requestParam?.command,
        msisdn,
        transactionId,
        offerCode,
        status,
        subscriptionStatus: status,
        subscriberLifeCycle: lifecycle,
        chargeAmount,
        nextBillingDate,
        normalizedStatus,
        operator,
        operatorResponse: req.body,
        callbackTimestamp: new Date(),
        payloadJson: { query: req.query, body: req.body },
        lifecycle,
        reason,
        rawQuery: req.query,
        rawBody: req.body,
        headers: req.headers,
        ...getClientMeta(req),
      };

      const savedSdpCallback = await CGWCallbackLog.create(sdpPayload).catch((error) => {
        console.error("SDP callback DB save error:", error.message);
        return null;
      });

      await SDPCallback.create(sdpPayload).catch((error) => {
        console.error("SDP dedicated callback DB save error:", error.message);
      });

      const savedSdpLog = await SDPLog.create(sdpPayload).catch((error) => {
        console.error("SDP sdplog DB save error:", error.message);
        return null;
      });

      await GhanaCallbackLog.create({
        callbackType: "SDP",
        flow: detectFlow(req),
        method: req.method,
        msisdn,
        offerCode,
        status,
        normalizedStatus,
        lifecycle,
        reason,
        chargingAmount: chargeAmount,
        rawQuery: req.query,
        rawBody: req.body,
        headers: req.headers,
        ...getClientMeta(req),
      }).catch((error) => {
        console.error("Ghana SDP callback log DB save error:", error.message);
      });

      if (savedSdpCallback) {
        console.log("SDP callback saved in DB:", savedSdpCallback._id.toString());
      }
      if (savedSdpLog) {
        console.log("SDP callback saved in sdplog:", savedSdpLog._id.toString());
      }

      if (msisdn) {
        await applySubscriptionStatus(msisdn, status, lifecycle);
      }

      return res.status(200).send("OK");
    }

    const callbackData = parseCGWCallback({
      ...(req.body?.data || {}),
      ...(req.body?.response || {}),
      ...req.body,
      ...req.query,
    });
    callbackData.msisdn = normalizeMsisdn(callbackData.msisdn);
    const offerCode = callbackData.offerId || req.query.offerCode || INITIAL_OFFER_CODE;

    console.log("========== CGW CALLBACK RECEIVED ==========");
    console.log("Method:", req.method);
    console.log("MSISDN:", callbackData.msisdn || "-");
    console.log("OfferCode:", offerCode || "-");
    console.log("Status:", callbackData.status || "-");
    console.log("CGID:", callbackData.cgid || "-");
    console.log("Query:", JSON.stringify(req.query));
    console.log("Body:", JSON.stringify(req.body));

    const statusMapping =
      callbackData.status !== undefined && callbackData.status !== null
        ? mapCGWStatus(callbackData.status, { offerCode })
        : null;
    const cgwPayload = {
      type: "CGW",
      method: req.method,
      msisdn: callbackData.msisdn,
      offerCode,
      status: callbackData.status,
      cgid: callbackData.cgid,
      rawQuery: req.query,
      rawBody: req.body,
      headers: req.headers,
      ...getClientMeta(req),
    };

    const savedCgwCallback = await CGWCallbackLog.create(cgwPayload).catch((error) => {
      console.error("CGW callback DB save error:", error.message);
      return null;
    });

    await CGWCallback.create(cgwPayload).catch((error) => {
      console.error("CGW dedicated callback DB save error:", error.message);
    });

    await GhanaCallbackLog.create({
      callbackType: "CGW",
      flow: detectFlow(req),
      method: req.method,
      msisdn: callbackData.msisdn,
      offerCode,
      status: callbackData.status,
      normalizedStatus: statusMapping?.success ? "success" : "failed",
      reason: statusMapping?.message,
      cgid: callbackData.cgid,
      rawQuery: req.query,
      rawBody: req.body,
      headers: req.headers,
      ...getClientMeta(req),
    }).catch((error) => {
      console.error("Ghana CGW callback log DB save error:", error.message);
    });

    if (savedCgwCallback) {
      console.log("CGW callback saved in DB:", savedCgwCallback._id.toString());
    }


    if (statusMapping.success) {
      const user = await applySubscriptionStatus(
        callbackData.msisdn,
        callbackData.status,
        "",
        offerCode
      );
      const token = createToken(user._id);
      const params = new URLSearchParams({
        subscribed: "true",
        msisdn: callbackData.msisdn,
        offerCode,
      });

      return res.redirect(`${FRONTEND_BASE_URL}/activation/callback?${params.toString()}`);
    }

    const params = new URLSearchParams({
      subscribed: "false",
      reason: statusMapping.message,
      offerCode,
    });

    return res.redirect(`${FRONTEND_BASE_URL}/activation/callback?${params.toString()}`);
  } catch (error) {
    console.error("CGW callback error:", error.message);
    const params = new URLSearchParams({
      subscribed: "false",
      reason: "Callback processing error",
    });
    return res.redirect(`${FRONTEND_BASE_URL}/activation/callback?${params.toString()}`);
  }
};
