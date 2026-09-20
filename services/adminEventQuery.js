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
const QUERY_TIME_MS = 20000;
const SCAN_CAP = 25000;

const SUCCESS_CGW = ["200", "0", "00", "a", "ok", "active", "activated", "success", "successful", "succuss"];
const ALREADY_CGW = ["9", "115"];
const FAILED_CGW = ["1", "11", "12", "13", "91", "112", "150", "186", "644", "1316", "d", "s"];
const CHURN_CGW = ["2", "26", "29", "55", "63", "111", "g"];

const withCasing = (values) =>
  [...new Set(values.flatMap((value) => [value, String(value).toUpperCase(), String(value).toLowerCase()]))];

const toDateOnly = (value) => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

export const resolveAdminRange = (query = {}, now = new Date()) => {
  const today = ghanaDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const fromInput =
    toDateOnly(query.fromDate || query.from || query.startDate || query.date) || monthStart;
  const toInput =
    toDateOnly(query.toDate || query.to || query.endDate || query.date || fromInput) || today;

  let from = fromInput <= toInput ? fromInput : toInput;
  let to = fromInput <= toInput ? toInput : fromInput;

  const fromTime = startOfGhanaDay(from).getTime();
  const toTime = startOfGhanaDay(to).getTime();
  const maxMs = (MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000;
  if (toTime - fromTime > maxMs) {
    from = ghanaDate(new Date(toTime - maxMs));
  }

  return {
    from,
    to,
    fromDate: startOfGhanaDay(from),
    toDate: endOfGhanaDay(to),
  };
};

const timeWindow = (fromDate, toDate) => ({
  $or: [
    { callbackTimestamp: { $gte: fromDate, $lte: toDate } },
    { createdAt: { $gte: fromDate, $lte: toDate } },
    { updatedAt: { $gte: fromDate, $lte: toDate } },
  ],
});

const sdpNewActivation = {
  $or: [
    { subscriberLifeCycle: { $regex: /^(sub|new)/i } },
    { lifecycle: { $regex: /^(sub|new)/i } },
    { command: { $regex: /^(sub|subscribe|activate)/i } },
    {
      subscriptionStatus: {
        $in: withCasing(["A", "200", "0", "00", "success", "successful", "active"]),
      },
    },
    {
      status: {
        $in: withCasing(["A", "200", "0", "00", "success", "successful", "active"]),
      },
    },
  ],
};

const sdpNotRenewalOrUnsub = {
  subscriberLifeCycle: { $not: /ren|unsub/i },
};

const sdpFilterForReport = (report, fromDate, toDate) => {
  const time = timeWindow(fromDate, toDate);
  if (report === "renewal") {
    return {
      $and: [
        time,
        {
          $or: [
            { subscriberLifeCycle: { $regex: /^ren/i } },
            { lifecycle: { $regex: /^ren/i } },
            { command: { $regex: /renew/i } },
            { normalizedStatus: "renewal" },
          ],
        },
      ],
    };
  }
  if (report === "success") {
    return {
      $and: [time, sdpNotRenewalOrUnsub, sdpNewActivation],
    };
  }
  if (report === "churn") {
    return {
      $and: [
        time,
        {
          $or: [
            { subscriptionStatus: { $in: withCasing(CHURN_CGW) } },
            { status: { $in: withCasing(CHURN_CGW) } },
            { reason: { $regex: /insufficient|low balance|churn/i } },
            { normalizedStatus: "churn" },
          ],
        },
      ],
    };
  }
  if (report === "failed") {
    return {
      $and: [
        time,
        {
          $or: [
            { subscriptionStatus: { $in: withCasing([...FAILED_CGW, "D", "S", "INACTIVE", "UNSUB"]) } },
            { subscriberLifeCycle: { $regex: /^unsub/i } },
            { lifecycle: { $regex: /^unsub/i } },
            { command: { $regex: /unsub/i } },
            { normalizedStatus: "failed" },
          ],
        },
      ],
    };
  }
  return time;
};

const cgwFilterForReport = (report, fromDate, toDate) => {
  const createdAt = { createdAt: { $gte: fromDate, $lte: toDate }, callbackType: { $ne: "SDP" } };
  if (report === "renewal") {
    return { ...createdAt, $or: [{ lifecycle: { $regex: /^ren/i } }, { normalizedStatus: "renewal" }] };
  }
  if (report === "success") {
    return {
      ...createdAt,
      $or: [
        { status: { $in: withCasing([...SUCCESS_CGW, ...ALREADY_CGW]) } },
        { normalizedStatus: "success" },
      ],
    };
  }
  if (report === "churn") {
    return {
      ...createdAt,
      $or: [
        { status: { $in: withCasing(CHURN_CGW) } },
        { normalizedStatus: "churn" },
        { reason: { $regex: /insufficient|low balance|churn/i } },
      ],
    };
  }
  if (report === "failed") {
    return {
      ...createdAt,
      $or: [
        { status: { $in: withCasing(FAILED_CGW) } },
        { normalizedStatus: "failed" },
      ],
    };
  }
  return createdAt;
};

const userMatchForRange = (fromDate, toDate) => ({
  $or: [
    { subscriptionStartTime: { $gte: fromDate, $lte: toDate } },
    {
      $and: [
        {
          $or: [
            { subscriptionStartTime: { $exists: false } },
            { subscriptionStartTime: null },
          ],
        },
        { createdAt: { $gte: fromDate, $lte: toDate } },
        { subscriptionStatus: "active" },
      ],
    },
  ],
});

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

const runFind = (model, filter, sort, skip, limit) =>
  model
    .find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .allowDiskUse(true)
    .maxTimeMS(QUERY_TIME_MS)
    .lean();

const countPair = async (report, fromDate, toDate) => {
  const includeUsers = report === "success" || report === "all";
  const [sdpTotal, cgwTotal, userTotal] = await Promise.all([
    SDPLog.countDocuments(sdpFilterForReport(report, fromDate, toDate)),
    GhanaCallbackLog.countDocuments(cgwFilterForReport(report, fromDate, toDate)),
    includeUsers ? User.countDocuments(userMatchForRange(fromDate, toDate)) : Promise.resolve(0),
  ]);
  return { sdpTotal, cgwTotal, userTotal, total: sdpTotal + cgwTotal + userTotal };
};

export const getAdminReportCounts = async (query = {}) => {
  const range = resolveAdminRange(query);
  const { fromDate, toDate } = range;
  const keys = ["all", "success", "renewal", "churn", "failed"];
  const entries = await Promise.all(keys.map(async (key) => [key, await countPair(key, fromDate, toDate)]));
  return {
    range,
    counts: Object.fromEntries(entries),
  };
};

export const getPaginatedAdminEvents = async (query = {}) => {
  const range = resolveAdminRange(query);
  const report = query.report || "all";
  const page = Math.max(1, Number(query.page) || 1);
  const requested = Math.max(1, Number(query.limit) || 10);
  const limit = Math.min(requested > 50 ? 200 : 50, requested);
  const skip = (page - 1) * limit;
  const { fromDate, toDate } = range;

  const sdpMatch = sdpFilterForReport(report, fromDate, toDate);
  const cgwMatch = cgwFilterForReport(report, fromDate, toDate);
  const includeUsers = report === "success" || report === "all";
  const userMatch = userMatchForRange(fromDate, toDate);
  const fetchCap = Math.min(SCAN_CAP, skip + limit);

  const [counts, sdpDocs, cgwDocs, userDocs] = await Promise.all([
    countPair(report, fromDate, toDate),
    runFind(SDPLog, sdpMatch, { callbackTimestamp: -1 }, 0, fetchCap),
    runFind(GhanaCallbackLog, cgwMatch, { createdAt: -1 }, 0, fetchCap),
    includeUsers
      ? User.find(userMatch)
          .select("phone subscriptionStartTime createdAt")
          .sort({ subscriptionStartTime: -1 })
          .limit(fetchCap)
          .allowDiskUse(true)
          .maxTimeMS(QUERY_TIME_MS)
          .lean()
      : Promise.resolve([]),
  ]);

  const merged = [
    ...sdpDocs.map(mapSdp),
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

  return {
    events: deduped.slice(skip, skip + limit),
    total: counts.total,
    summaryEvents: deduped.slice(0, 200),
    counts,
    range,
  };
};

export const loadDailySubscriptionEvents = async (from, to) => {
  const fromDate = startOfGhanaDay(from);
  const toDate = endOfGhanaDay(to);
  const time = timeWindow(fromDate, toDate);
  const dailyPlan = getOfferPlan(INITIAL_OFFER_CODE);

  const sdpNewMatch = {
    $and: [time, sdpNotRenewalOrUnsub, sdpNewActivation],
  };

  const [callbacks, sdpLogs, sdpRenewals, sdpUnsubs, users] = await Promise.all([
    GhanaCallbackLog.find({
      createdAt: { $gte: fromDate, $lte: toDate },
    })
      .select("msisdn offerCode status normalizedStatus lifecycle reason chargingAmount createdAt callbackType flow rawBody rawQuery")
      .sort({ createdAt: 1 })
      .limit(SCAN_CAP)
      .allowDiskUse(true)
      .maxTimeMS(QUERY_TIME_MS)
      .lean(),
    SDPLog.find(sdpNewMatch)
      .select("msisdn offerCode planId subscriptionStatus subscriberLifeCycle command status lifecycle reason chargeAmount createdAt callbackTimestamp channel rawBody rawQuery payloadJson")
      .sort({ callbackTimestamp: 1 })
      .limit(SCAN_CAP)
      .allowDiskUse(true)
      .maxTimeMS(QUERY_TIME_MS)
      .lean(),
    SDPLog.countDocuments({
      $and: [
        time,
        {
          $or: [
            { subscriberLifeCycle: { $regex: /^ren/i } },
            { lifecycle: { $regex: /^ren/i } },
            { command: { $regex: /renew/i } },
          ],
        },
      ],
    }),
    SDPLog.countDocuments({
      $and: [
        time,
        {
          $or: [
            { subscriberLifeCycle: { $regex: /^unsub/i } },
            { lifecycle: { $regex: /^unsub/i } },
            { command: { $regex: /unsub/i } },
          ],
        },
      ],
    }),
    User.find(userMatchForRange(fromDate, toDate))
      .select("phone subscriptionStartTime subscriptionStatus createdAt")
      .sort({ subscriptionStartTime: 1 })
      .limit(SCAN_CAP)
      .allowDiskUse(true)
      .maxTimeMS(QUERY_TIME_MS)
      .lean(),
  ]);

  const events = [
    ...callbacks.map((item) => ({
      ...item,
      source: item.callbackType || "CGW",
    })),
    ...sdpLogs.map((item) => ({
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
    extras: {
      renewals: sdpRenewals,
      unsub: sdpUnsubs,
    },
  };
};
