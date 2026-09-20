import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import SDPLog from "../models/SDPLog.js";
import User from "../models/User.js";
import {
  ghanaDate,
  startOfGhanaDay,
  endOfGhanaDay,
} from "./dailySubscriptionReport.js";
import { INITIAL_OFFER_CODE, getOfferPlan } from "../config/cgwconfig.js";

const MAX_RANGE_DAYS = 31;
const QUERY_TIME_MS = 12000;
const PAGE_SCAN = 2500;

const SUCCESS_CGW = ["200", "0", "00", "a", "ok", "active", "activated", "success", "successful", "succuss"];
const ALREADY_CGW = ["9", "115"];
const FAILED_CGW = ["1", "11", "12", "13", "91", "112", "150", "186", "644", "1316", "d", "s"];
const CHURN_CGW = ["2", "26", "29", "55", "63", "111", "g"];

const toDateOnly = (value) => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

export const resolveAdminRange = (query = {}, now = new Date()) => {
  const today = ghanaDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const fromInput =
    toDateOnly(query.fromDate || query.from || query.startDate) || monthStart;
  const toInput =
    toDateOnly(query.toDate || query.to || query.endDate) || fromInput || today;

  let from = fromInput || monthStart;
  let to = toInput || today;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  const fromTime = startOfGhanaDay(from).getTime();
  const maxToTime = fromTime + (MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000;
  const requestedTo = startOfGhanaDay(to).getTime();
  if (requestedTo > maxToTime) {
    to = ghanaDate(new Date(maxToTime));
  }

  return {
    from,
    to,
    fromDate: startOfGhanaDay(from),
    toDate: endOfGhanaDay(to),
  };
};

const normalizeStatus = (status = "", reason = "", lifecycle = "") => {
  const statusText = String(status).toLowerCase();
  const reasonText = String(reason).toLowerCase();
  const lifecycleText = String(lifecycle).toLowerCase();
  if (lifecycleText.startsWith("unsub") || statusText.includes("unsub")) return "failed";
  if (reasonText.includes("insufficient") || reasonText.includes("low balance") || reasonText.includes("churn") || CHURN_CGW.includes(statusText)) {
    return "churn";
  }
  if (lifecycleText.startsWith("ren") || reasonText.includes("renew")) return "renewal";
  if (SUCCESS_CGW.includes(statusText) || ALREADY_CGW.includes(statusText) || statusText.includes("alreadysubscrib")) {
    return "success";
  }
  if (FAILED_CGW.includes(statusText) || ["failed", "failure", "fail", "deactivated", "inactive", "suspended"].includes(statusText)) {
    return "failed";
  }
  return statusText || "unknown";
};

const mapCgw = (item) => ({
  id: String(item._id || item.cgid || ""),
  msisdn: item.msisdn || "",
  offerCode: item.offerCode || "",
  reason: item.reason || "-",
  nextBillingDate: "",
  status: item.normalizedStatus || normalizeStatus(item.status, item.reason, item.lifecycle),
  rawStatus: item.status || "-",
  chargingAmount: Number(item.chargingAmount || 0),
  lifecycle: item.lifecycle || "-",
  source: "CGW Callback",
  flow: item.flow || "UNKNOWN",
  cgid: item.cgid || "",
  createdAt: item.createdAt || item.updatedAt,
});

const mapSdp = (item) => ({
  id: String(item._id || item.transactionId || item.requestId || ""),
  msisdn: item.msisdn || "",
  offerCode: item.offerCode || item.planId || "",
  reason: item.reason || "-",
  nextBillingDate: item.nextBillingDate || "",
  status:
    item.normalizedStatus ||
    normalizeStatus(item.subscriptionStatus || item.status, item.reason, item.subscriberLifeCycle || item.lifecycle),
  rawStatus: item.subscriptionStatus || item.status || "-",
  chargingAmount: Number(item.chargeAmount || 0),
  lifecycle: item.subscriberLifeCycle || item.lifecycle || "-",
  source: "SDP Callback",
  flow: item.channel || "SDP",
  cgid: "",
  transactionId: item.transactionId || "",
  requestId: item.requestId || "",
  createdAt: item.callbackTimestamp || item.createdAt || item.updatedAt,
});

const mapUser = (user) => ({
  id: String(user._id),
  msisdn: String(user.phone || "").replace(/\D/g, ""),
  offerCode: INITIAL_OFFER_CODE,
  reason: "User activation",
  nextBillingDate: "",
  status: "success",
  rawStatus: "200",
  chargingAmount: Number(getOfferPlan(INITIAL_OFFER_CODE).amountGhs || 0),
  lifecycle: "SUB",
  source: "User",
  flow: "LOCAL",
  cgid: "",
  createdAt: user.subscriptionStartTime || user.createdAt,
});

const matchesReport = (event, report) => {
  if (!report || report === "all") return true;
  const status = String(event.status || "").toLowerCase();
  const raw = String(event.rawStatus || "").toLowerCase();
  const life = String(event.lifecycle || "").toLowerCase();
  if (report === "success") {
    if (status === "renewal" || life.startsWith("ren") || life.includes("unsub")) return false;
    return (
      status === "success" ||
      ["a", "200", "0", "00", "active", "activated", "ok"].includes(raw) ||
      life.startsWith("sub") ||
      life === "new"
    );
  }
  if (report === "renewal") return status === "renewal" || life.startsWith("ren");
  if (report === "churn") return status === "churn";
  if (report === "failed") return status === "failed" || life.includes("unsub");
  return status === report;
};

const emptyPage = (range) => ({
  events: [],
  total: 0,
  summaryEvents: [],
  counts: { sdpTotal: 0, cgwTotal: 0, userTotal: 0, total: 0 },
  range,
});

const safeQuery = async (label, work, fallback) => {
  try {
    return await work();
  } catch (error) {
    console.error(`Admin ${label} failed:`, error.message);
    return fallback;
  }
};

const findByTime = (model, field, fromDate, toDate, _sortField, limit) =>
  safeQuery(
    `${model.modelName}.${field}`,
    () =>
      model
        .find({ [field]: { $gte: fromDate, $lte: toDate } })
        .select(
          model.modelName === "SDPLog"
            ? "msisdn offerCode planId subscriptionStatus subscriberLifeCycle command status lifecycle reason chargeAmount createdAt callbackTimestamp channel"
            : model.modelName === "User"
              ? "phone subscriptionStartTime createdAt"
              : "msisdn offerCode status normalizedStatus lifecycle reason chargingAmount createdAt callbackType flow"
        )
        .limit(limit)
        .maxTimeMS(QUERY_TIME_MS)
        .lean(),
    []
  );

export const getAdminReportCounts = async (query = {}) => {
  const range = resolveAdminRange(query);
  return {
    range,
    counts: {
      all: { total: 0 },
      success: { total: 0 },
      renewal: { total: 0 },
      churn: { total: 0 },
      failed: { total: 0 },
    },
  };
};

export const getPaginatedAdminEvents = async (query = {}) => {
  const range = resolveAdminRange(query);
  try {
    const report = query.report || "all";
    const page = Math.max(1, Number(query.page) || 1);
    const requested = Math.max(1, Number(query.limit) || 10);
    const limit = Math.min(50, requested);
    const skip = (page - 1) * limit;
    const { fromDate, toDate } = range;

    const [sdpCallback, sdpCreated, cgwDocs, userDocs] = await Promise.all([
      findByTime(SDPLog, "callbackTimestamp", fromDate, toDate, "callbackTimestamp", PAGE_SCAN),
      findByTime(SDPLog, "createdAt", fromDate, toDate, "createdAt", PAGE_SCAN),
      findByTime(GhanaCallbackLog, "createdAt", fromDate, toDate, "createdAt", PAGE_SCAN),
      findByTime(User, "subscriptionStartTime", fromDate, toDate, "subscriptionStartTime", PAGE_SCAN),
    ]);

    const merged = [
      ...sdpCallback.map(mapSdp),
      ...sdpCreated.map(mapSdp),
      ...cgwDocs.map(mapCgw),
      ...userDocs.map(mapUser),
    ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const uniqueKeys = new Set();
    const deduped = [];
    for (const event of merged) {
      const key = `${event.source}|${event.id || event.msisdn}|${event.createdAt || ""}`;
      if (uniqueKeys.has(key)) continue;
      uniqueKeys.add(key);
      deduped.push(event);
    }

    const filtered = deduped.filter((event) => matchesReport(event, report));
    return {
      events: filtered.slice(skip, skip + limit),
      total: filtered.length,
      summaryEvents: filtered.slice(0, 200),
      counts: {
        sdpTotal: sdpCallback.length + sdpCreated.length,
        cgwTotal: cgwDocs.length,
        userTotal: userDocs.length,
        total: filtered.length,
      },
      range,
    };
  } catch (error) {
    console.error("getPaginatedAdminEvents failed:", error.message);
    return emptyPage(range);
  }
};

export const loadDailySubscriptionEvents = async (from, to) => {
  const fromDate = startOfGhanaDay(from);
  const toDate = endOfGhanaDay(to);
  const dailyPlan = getOfferPlan(INITIAL_OFFER_CODE);

  const [callbacks, sdpCallback, sdpCreated, users] = await Promise.all([
    findByTime(GhanaCallbackLog, "createdAt", fromDate, toDate, "createdAt", 3000),
    findByTime(SDPLog, "callbackTimestamp", fromDate, toDate, "callbackTimestamp", 3000),
    findByTime(SDPLog, "createdAt", fromDate, toDate, "createdAt", 3000),
    findByTime(User, "subscriptionStartTime", fromDate, toDate, "subscriptionStartTime", 3000),
  ]);

  const events = [
    ...callbacks.map((item) => ({
      ...item,
      source: item.callbackType || "CGW",
    })),
    ...[...sdpCallback, ...sdpCreated].map((item) => ({
      ...item,
      source: "SDP",
      status: item.subscriptionStatus || item.status,
      lifecycle: item.subscriberLifeCycle || item.lifecycle,
      createdAt: item.callbackTimestamp || item.createdAt,
    })),
    ...users.map((user) => ({
      msisdn: user.phone,
      offerCode: INITIAL_OFFER_CODE,
      status: "200",
      lifecycle: "SUB",
      source: "USER",
      flow: "LOCAL",
      chargingAmount: dailyPlan.amountGhs,
      createdAt: user.subscriptionStartTime || user.createdAt,
    })),
  ];

  return {
    events,
    extras: { renewals: 0, unsub: 0 },
  };
};
