import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import SDPCallback from "../models/SDPCallback.js";
import SDPLog from "../models/SDPLog.js";
import {
  buildDailySubscriptionReport,
  resolveReportRange,
  startOfGhanaDay,
  endOfGhanaDay,
  ghanaDate,
  toReportEvent,
} from "./dailySubscriptionReport.js";

const MAX_RANGE_DAYS = 31;
const QUERY_TIME_MS = 8000;
const SCAN = 1500;

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
  "msisdn offerCode planId subscriptionStatus subscriberLifeCycle command status lifecycle reason chargeAmount chargingAmount createdAt callbackTimestamp channel";

const dateRangeOr = (fromDate, toDate) => ({
  $or: [
    { callbackTimestamp: { $gte: fromDate, $lte: toDate } },
    { createdAt: { $gte: fromDate, $lte: toDate } },
  ],
});

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

const findSdpByDate = async (fromDate, toDate) => {
  const filter = dateRangeOr(fromDate, toDate);
  const [sdpLogs, sdpCallbacks] = await Promise.all([
    safeFind("SDPLog.range", () =>
      SDPLog.find(filter)
        .select(SDP_SELECT)
        .limit(SCAN)
        .maxTimeMS(QUERY_TIME_MS)
        .lean()
    ),
    safeFind("SDPCallback.range", () =>
      SDPCallback.find(filter)
        .select("msisdn offerCode status lifecycle reason createdAt callbackTimestamp")
        .limit(SCAN)
        .maxTimeMS(QUERY_TIME_MS)
        .lean()
    ),
  ]);
  return uniqueDocs([...sdpLogs, ...sdpCallbacks]);
};

const findCgwByDate = async (fromDate, toDate) =>
  safeFind("GhanaCallbackLog.range", () =>
    GhanaCallbackLog.find({
      createdAt: { $gte: fromDate, $lte: toDate },
      callbackType: { $in: ["SDP", "CGW"] },
    })
      .select("msisdn offerCode status normalizedStatus lifecycle reason chargingAmount createdAt callbackType flow")
      .limit(SCAN)
      .maxTimeMS(QUERY_TIME_MS)
      .lean()
  );

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

export const loadAdminRangeEvents = async (fromDate, toDate) => {
  const [sdpDocs, ghanaDocs] = await Promise.all([
    findSdpByDate(fromDate, toDate),
    findCgwByDate(fromDate, toDate),
  ]);

  return [
    ...sdpDocs.map((item) => toTableEvent(item, "SDP")),
    ...ghanaDocs.map((item) => toTableEvent(item, item.callbackType || "CGW")),
  ];
};

const matchesTab = (event, report) => {
  if (!report || report === "all") return event.type !== "other";
  if (report === "success") return event.type === "new";
  if (report === "renewal") return event.type === "renewal";
  if (report === "churn") return event.type === "churn";
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
    const limit = Math.min(50, requested);
    const skip = (page - 1) * limit;

    const allEvents = await loadAdminRangeEvents(range.fromDate, range.toDate);
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
