import mongoose from "mongoose";
import { INITIAL_OFFER_CODE } from "../config/cgwconfig.js";
import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import SDPCallback from "../models/SDPCallback.js";
import SDPLog from "../models/SDPLog.js";
import User from "../models/User.js";
import {
  buildDailySubscriptionReport,
  resolveReportRange,
  startOfGhanaDay,
  endOfGhanaDay,
  ghanaDate,
  toReportEvent,
} from "./dailySubscriptionReport.js";

const MAX_RANGE_DAYS = 31;
const QUERY_TIME_MS = 20000;
const SCAN = 1500;
const REPORT_SCAN = 5000;

const toDateOnly = (value) => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

export const resolveAdminRange = (query = {}, now = new Date()) => {
  const today = ghanaDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const fromInput = toDateOnly(query.fromDate || query.from || query.startDate) || monthStart;
  const toInput = toDateOnly(query.toDate || query.to || query.endDate) || fromInput || today;

  let from = fromInput || monthStart;
  let to = toInput || today;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  const fromTime = startOfGhanaDay(from).getTime();
  const maxToTime = fromTime + (MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000;
  if (startOfGhanaDay(to).getTime() > maxToTime) {
    to = ghanaDate(new Date(maxToTime));
  }

  return {
    from,
    to,
    fromDate: startOfGhanaDay(from),
    toDate: endOfGhanaDay(to),
  };
};

const emptyPage = (range) => ({
  events: [],
  total: 0,
  summaryEvents: [],
  allEvents: [],
  counts: { sdpTotal: 0, cgwTotal: 0, userTotal: 0, total: 0 },
  range,
});

const safeFind = async (label, exec) => {
  try {
    return await exec();
  } catch (error) {
    console.error(`Admin ${label} failed:`, error.message);
    return [];
  }
};

const SDP_SELECT =
  "msisdn offerCode planId subscriptionStatus subscriberLifeCycle command status lifecycle reason normalizedStatus chargeAmount chargingAmount createdAt callbackTimestamp channel";
const SDP_CALLBACK_SELECT =
  "msisdn offerCode status lifecycle reason createdAt callbackTimestamp subscriberLifeCycle command";
const GHANA_SELECT =
  "msisdn offerCode status normalizedStatus lifecycle reason chargingAmount createdAt callbackType flow";

const objectIdRange = (fromDate, toDate) => {
  const fromSec = Math.floor(new Date(fromDate).getTime() / 1000);
  const toSec = Math.floor(new Date(toDate).getTime() / 1000) + 1;
  const fromId = mongoose.Types.ObjectId.createFromTime(fromSec);
  const toId = mongoose.Types.ObjectId.createFromTime(toSec);
  return { _id: { $gte: fromId, $lte: toId } };
};

const uniqueDocs = (items) => {
  const seen = new Set();
  const docs = [];
  for (const item of items) {
    const id = String(item._id || item.transactionId || item.requestId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    docs.push(item);
  }
  return docs;
};

const findNoSort = (model, label, filter, select, limit = SCAN) =>
  safeFind(label, () =>
    model.find(filter).select(select).limit(limit).maxTimeMS(QUERY_TIME_MS).lean()
  );

const renewalMatch = {
  $or: [
    { subscriberLifeCycle: /ren/i },
    { lifecycle: /ren/i },
    { normalizedStatus: /renew/i },
    { reason: /renew/i },
    { command: /renew/i },
  ],
};

const churnMatch = {
  $or: [
    { normalizedStatus: /churn/i },
    { reason: /insufficient|low balance|churn/i },
    { subscriptionStatus: { $in: ["2", "26", "29", "55", "63", "111", "G", "g"] } },
    { status: { $in: ["2", "26", "29", "55", "63", "111", "G", "g"] } },
  ],
};

const findSdpByDate = async (fromDate, toDate, report = "all") => {
  const tsRange = { callbackTimestamp: { $gte: fromDate, $lte: toDate } };
  const createdRange = { createdAt: { $gte: fromDate, $lte: toDate } };
  const idRange = objectIdRange(fromDate, toDate);
  const targeted = report === "renewal" ? renewalMatch : report === "churn" ? churnMatch : null;

  if (targeted) {
    const filterFor = (timeFilter) => ({ $and: [timeFilter, targeted] });
    const docs = await Promise.all([
      findNoSort(SDPLog, "SDPLog.createdAt.report", filterFor(createdRange), SDP_SELECT, REPORT_SCAN),
      findNoSort(SDPLog, "SDPLog.callbackTimestamp.report", filterFor(tsRange), SDP_SELECT, REPORT_SCAN),
      findNoSort(SDPLog, "SDPLog._id.report", filterFor(idRange), SDP_SELECT, REPORT_SCAN),
      findNoSort(SDPCallback, "SDPCallback.createdAt.report", filterFor(createdRange), SDP_CALLBACK_SELECT, REPORT_SCAN),
      findNoSort(SDPCallback, "SDPCallback.callbackTimestamp.report", filterFor(tsRange), SDP_CALLBACK_SELECT, REPORT_SCAN),
    ]);
    return uniqueDocs(docs.flat());
  }

  const [byId, byTimestamp, byCreated, callbacksById, callbacksByTs] = await Promise.all([
    findNoSort(SDPLog, "SDPLog._id", idRange, SDP_SELECT),
    findNoSort(SDPLog, "SDPLog.callbackTimestamp", tsRange, SDP_SELECT),
    findNoSort(SDPLog, "SDPLog.createdAt", createdRange, SDP_SELECT),
    findNoSort(SDPCallback, "SDPCallback._id", idRange, SDP_CALLBACK_SELECT),
    findNoSort(SDPCallback, "SDPCallback.callbackTimestamp", tsRange, SDP_CALLBACK_SELECT),
  ]);
  return uniqueDocs([...byId, ...byTimestamp, ...byCreated, ...callbacksById, ...callbacksByTs]);
};

const findCgwByDate = async (fromDate, toDate, report = "all") => {
  const createdRange = { createdAt: { $gte: fromDate, $lte: toDate } };
  const targeted = report === "renewal" ? renewalMatch : report === "churn" ? churnMatch : null;
  if (targeted) {
    return findNoSort(
      GhanaCallbackLog,
      "GhanaCallbackLog.report",
      { $and: [createdRange, targeted] },
      GHANA_SELECT,
      REPORT_SCAN
    );
  }

  const [sdp, cgw, untyped] = await Promise.all([
    findNoSort(GhanaCallbackLog, "GhanaCallbackLog.SDP", { ...createdRange, callbackType: "SDP" }, GHANA_SELECT),
    findNoSort(GhanaCallbackLog, "GhanaCallbackLog.CGW", { ...createdRange, callbackType: "CGW" }, GHANA_SELECT),
    findNoSort(GhanaCallbackLog, "GhanaCallbackLog.any", createdRange, GHANA_SELECT),
  ]);
  return uniqueDocs([...sdp, ...cgw, ...untyped]);
};

const findActiveUsersByDate = async (fromDate, toDate) => {
  const users = await safeFind("User.active", () =>
    User.find({ subscriptionStatus: "active" })
      .select("phone subscriptionStatus subscriptionStartTime createdAt")
      .limit(5000)
      .maxTimeMS(QUERY_TIME_MS)
      .lean()
  );
  const fromMs = new Date(fromDate).getTime();
  const toMs = new Date(toDate).getTime();
  return users
    .filter((user) => user.phone)
    .map((user) => {
      const stamp = user.subscriptionStartTime || user.createdAt;
      const time = new Date(stamp || 0).getTime();
      if (!Number.isFinite(time) || time < fromMs || time > toMs) return null;
      return {
        _id: user._id,
        msisdn: user.phone,
        offerCode: INITIAL_OFFER_CODE,
        status: "active",
        lifecycle: "SUB",
        chargingAmount: 1,
        createdAt: stamp,
        source: "USER",
      };
    })
    .filter(Boolean);
};

const toTableEvent = (item, source) => {
  const reportEvent = toReportEvent({ ...item, source }, source);
  const lifecycle = String(item.subscriberLifeCycle || item.lifecycle || "").trim();
  const rawStatus = String(
    item.status || item.subscriptionStatus || item.normalizedStatus || reportEvent.status || ""
  ).trim();
  return {
    id: reportEvent.id,
    msisdn: reportEvent.msisdn,
    offerCode: reportEvent.offerCode,
    planName: reportEvent.planName,
    reason: reportEvent.reason,
    nextBillingDate: item.nextBillingDate || "",
    status: reportEvent.type === "new" ? "success" : reportEvent.type,
    rawStatus,
    chargingAmount: reportEvent.priceGhs,
    priceGhs: reportEvent.priceGhs,
    lifecycle,
    subscriberLifeCycle: lifecycle,
    source: reportEvent.source,
    flow: reportEvent.flow,
    type: reportEvent.type,
    createdAt: reportEvent.createdAt,
  };
};

export const loadAdminRangeEvents = async (fromDate, toDate, report = "all") => {
  const skipUsers = report === "renewal" || report === "churn" || report === "failed";
  const [sdpDocs, ghanaDocs, userDocs] = await Promise.all([
    findSdpByDate(fromDate, toDate, report),
    findCgwByDate(fromDate, toDate, report),
    skipUsers ? Promise.resolve([]) : findActiveUsersByDate(fromDate, toDate),
  ]);

  return [
    ...sdpDocs.map((item) => toTableEvent(item, "SDP")),
    ...ghanaDocs.map((item) => toTableEvent(item, item.callbackType || "CGW")),
    ...userDocs.map((item) => toTableEvent(item, "USER")),
  ];
};

const matchesTab = (event, report) => {
  if (!report || report === "all") return event.type !== "other";
  if (report === "success") return event.type === "new";
  const lifecycle = String(event.lifecycle || event.subscriberLifeCycle || "").toLowerCase();
  const reason = String(event.reason || "").toLowerCase();
  const status = String(event.status || event.rawStatus || event.type || "").toLowerCase();
  if (report === "renewal") {
    return event.type === "renewal" || status.includes("renew") || lifecycle.includes("ren") || reason.includes("renew");
  }
  if (report === "churn") {
    return event.type === "churn" || status.includes("churn") || /insufficient|low balance|churn/.test(reason);
  }
  if (report === "failed") return event.type === "failed" || event.type === "unsub";
  return event.type === report;
};

export const getAdminReportCounts = async (query = {}) => ({
  range: resolveAdminRange(query),
  counts: {
    all: { total: 0 },
    success: { total: 0 },
    renewal: { total: 0 },
    churn: { total: 0 },
    failed: { total: 0 },
  },
});

export const getPaginatedAdminEvents = async (query = {}) => {
  const range = resolveAdminRange(query);
  try {
    const report = query.report || "all";
    const page = Math.max(1, Number(query.page) || 1);
    const requested = Math.max(1, Number(query.limit) || 10);
    const maxRows = report === "renewal" || report === "churn" ? 500 : 50;
    const limit = Math.min(maxRows, requested);
    const skip = (page - 1) * limit;

    const allEvents = await loadAdminRangeEvents(range.fromDate, range.toDate, report);
    const uniqueKeys = new Set();
    const deduped = [];
    for (const event of allEvents.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    )) {
      if (!event.msisdn) continue;
      const key = `${event.type}|${event.msisdn}|${String(event.createdAt || "").slice(0, 16)}`;
      if (uniqueKeys.has(key)) continue;
      uniqueKeys.add(key);
      deduped.push(event);
    }

    const filtered = deduped.filter((event) => matchesTab(event, report));
    return {
      events: filtered.slice(skip, skip + limit),
      total: filtered.length,
      summaryEvents: filtered,
      allEvents: deduped,
      counts: { total: filtered.length },
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
  const events = await loadAdminRangeEvents(fromDate, toDate);
  return {
    events: events.map((event) => ({
      msisdn: event.msisdn,
      offerCode: event.offerCode,
      status: event.rawStatus || event.status,
      lifecycle: event.lifecycle,
      source: event.source,
      flow: event.flow,
      chargingAmount: event.priceGhs,
      createdAt: event.createdAt,
    })),
    extras: { renewals: 0, unsub: 0 },
  };
};

export const buildDashboardPayload = async (query = {}) => {
  const pageData = await getPaginatedAdminEvents(query);
  const range = resolveReportRange({
    from: pageData.range.from,
    to: pageData.range.to,
  });
  const daily = buildDailySubscriptionReport(
    (pageData.allEvents || []).map((event) => ({
      msisdn: event.msisdn,
      offerCode: event.offerCode,
      status: event.rawStatus,
      subscriptionStatus: event.rawStatus,
      lifecycle: event.lifecycle === "-" ? "" : event.lifecycle,
      subscriberLifeCycle: event.subscriberLifeCycle || (event.lifecycle === "-" ? "" : event.lifecycle),
      source: event.source,
      flow: event.flow,
      chargingAmount: event.priceGhs,
      createdAt: event.createdAt,
    })),
    range
  );

  return {
    success: true,
    summary: {
      totalSubscribers: daily.summary.uniqueUsers,
      success: daily.summary.newSubscriptions,
      renewals: daily.summary.renewals,
      alreadySubscribed: daily.summary.alreadySubscribed,
      totalGhsAmount: Number(
        (Number(daily.summary.newRevenueGhs || 0) + Number(daily.summary.renewalRevenueGhs || 0)).toFixed(2)
      ),
      newRevenueGhs: daily.summary.newRevenueGhs,
      topup: daily.summary.topup,
    },
    data: pageData.events,
    subscribers: daily.daily.flatMap((day) =>
      (day.subscriptions || []).map((row) => ({
        ...row,
        status: row.status || "success",
        type: "new",
      }))
    ),
    renewalRows: (pageData.allEvents || []).filter((event) => event.type === "renewal"),
    churnRows: (pageData.allEvents || []).filter((event) => event.type === "churn"),
    total: pageData.total,
    range: pageData.range,
    daily: daily.daily,
    view: daily.view,
    plans: daily.plans,
    timezone: daily.timezone,
    currency: daily.currency,
    subscriptionUsage: [],
  };
};
