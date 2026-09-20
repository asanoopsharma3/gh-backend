import {
  INITIAL_OFFER_CODE,
  TOPUP_OFFER_CODE,
  getOfferPlan,
  mapCGWStatus,
  normalizeConsentFlow,
  normalizeMsisdn,
  parseChargeAmountGhs,
  resolvePriceGhs,
} from "../config/cgwconfig.js";

export const GHANA_TIMEZONE = "Africa/Accra";
export const MAX_REPORT_DAYS = 90;

const SUCCESS_STATUSES = new Set([
  "a",
  "0",
  "00",
  "200",
  "ok",
  "active",
  "activated",
  "success",
  "successful",
  "succuss",
]);

const CHURN_STATUSES = new Set(["2", "26", "29", "55", "63", "111", "g"]);
const FAILED_STATUSES = new Set([
  "1",
  "11",
  "12",
  "13",
  "91",
  "112",
  "150",
  "186",
  "644",
  "1316",
  "d",
  "s",
  "failed",
  "failure",
  "fail",
  "inactive",
  "deactivated",
  "deactive",
  "suspended",
  "unsub",
  "unsubscribed",
]);

const SOURCE_RANK = { CGW: 3, SDP: 2, USER: 1, LOCAL: 1 };

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") ?? "";

export const ghanaDate = (value = new Date()) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: GHANA_TIMEZONE });

export const startOfGhanaDay = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);

export const endOfGhanaDay = (dateStr) => new Date(`${dateStr}T23:59:59.999Z`);

export const eachGhanaDate = (from, to) => {
  const dates = [];
  const cursor = startOfGhanaDay(from);
  const last = startOfGhanaDay(to);

  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

const isValidDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

export const resolveReportRange = (query = {}, now = new Date()) => {
  const today = ghanaDate(now);
  const fromInput = String(query.from || query.startDate || query.date || today).slice(0, 10);
  const toInput = String(query.to || query.endDate || query.date || fromInput).slice(0, 10);
  const from = isValidDateOnly(fromInput) ? fromInput : today;
  const to = isValidDateOnly(toInput) ? toInput : from;

  if (from > to) {
    return { from: to, to: from, view: to === from ? "daily" : "range", today };
  }

  const days = eachGhanaDate(from, to);
  if (days.length > MAX_REPORT_DAYS) {
    const limitedTo = days[MAX_REPORT_DAYS - 1];
    return {
      from,
      to: limitedTo,
      view: from === limitedTo ? "daily" : "range",
      today,
      truncated: true,
      maxDays: MAX_REPORT_DAYS,
    };
  }

  return {
    from,
    to,
    view: from === to ? "daily" : "range",
    today,
  };
};

export const normalizePhone = (value) => {
  const normalized = normalizeMsisdn(value);
  if (normalized) return normalized;
  return String(value || "").replace(/\D/g, "") || "";
};

const compactText = (value) => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

const getNested = (source, paths) => {
  for (const path of paths) {
    const value = path.split(".").reduce((obj, part) => (obj ? obj[part] : undefined), source);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
};

const extractSdpNamedValue = (raw, names) => {
  const data = raw?.requestParam?.data;
  if (!Array.isArray(data)) return "";
  const lookup = names.map((name) => String(name).toLowerCase());
  return (
    data.find((item) => lookup.includes(String(item?.name || "").toLowerCase()))?.value || ""
  );
};

export const extractChargeCandidates = (item = {}) => {
  const raw = item.rawBody || item.rawQuery || item.payloadJson || item.operatorResponse || {};
  return [
    item.chargingAmount,
    item.chargeAmount,
    item.amount,
    item.ghsAmount,
    getNested(raw, [
      "chargingAmount",
      "ChargingAmount",
      "chargeAmount",
      "ChargeAmount",
      "amount",
      "Amount",
    ]),
    extractSdpNamedValue(raw, ["ChargeAmount", "ChargingAmount", "Amount"]),
    extractSdpNamedValue(raw.body || {}, ["ChargeAmount", "ChargingAmount", "Amount"]),
  ];
};

export const isAlreadySubscribedStatus = (status) => {
  const statusText = String(status || "").trim().toLowerCase();
  const compact = compactText(status);
  return (
    ["9", "115"].includes(statusText) ||
    compact.includes("alreadysubscrib") ||
    (statusText.includes("already") && statusText.includes("subscrib")) ||
    mapCGWStatus(status).message === "Already subscribed"
  );
};

const isSuccessStatus = (status) => {
  const statusText = String(status || "").trim().toLowerCase();
  if (SUCCESS_STATUSES.has(statusText) || SUCCESS_STATUSES.has(compactText(status))) return true;
  return Boolean(mapCGWStatus(status).success) && !isAlreadySubscribedStatus(status);
};

const includesAny = (value, fragments) => {
  const text = String(value || "").toLowerCase();
  return fragments.some((fragment) => text.includes(fragment));
};

const sourceName = (item = {}, fallback = "CGW") => {
  const raw = String(item.source || item.callbackType || fallback || "CGW").toUpperCase();
  if (raw.includes("SDP")) return "SDP";
  if (raw.includes("USER") || raw.includes("LOCAL")) return "USER";
  return "CGW";
};

export const classifySubscriptionEvent = (item = {}) => {
  const status = pickFirst(item.status, item.subscriptionStatus, item.rawStatus);
  const lifecycle = pickFirst(item.lifecycle, item.subscriberLifeCycle);
  const reason = pickFirst(item.reason, item.resultMessage);
  const command = pickFirst(item.command);
  const offerCode = String(pickFirst(item.offerCode, item.planId) || INITIAL_OFFER_CODE);
  const source = sourceName(item);
  const isSdp = source === "SDP";
  const compactLifecycle = compactText(lifecycle);
  const compactCommand = compactText(command);
  const plan = getOfferPlan(offerCode);

  const normalized = compactText(item.normalizedStatus);

  if (compactLifecycle.includes("unsub") || compactCommand.includes("unsub") || compactText(status).includes("unsub")) {
    return "unsub";
  }
  if (
    compactLifecycle.includes("ren") ||
    compactLifecycle.includes("renew") ||
    normalized.includes("renew") ||
    includesAny(reason, ["renew"]) ||
    compactCommand.includes("renew")
  ) {
    return "renewal";
  }
  if (
    normalized.includes("churn") ||
    includesAny(reason, ["insufficient", "low balance", "churn"]) ||
    CHURN_STATUSES.has(String(status).trim().toLowerCase())
  ) {
    return "churn";
  }
  if (isAlreadySubscribedStatus(status)) return "already_subscribed";

  const billingSuccess = isSuccessStatus(status);
  const isTopup =
    billingSuccess &&
    (plan.billing === "one-time" || String(offerCode) === String(TOPUP_OFFER_CODE));

  if (isTopup) return "topup";

  if (!isSdp) {
    return mapCGWStatus(status).success ? "new" : "failed";
  }

  const isNewLifecycle = ["sub", "new", "newsub", "activation", "activated"].includes(
    compactLifecycle
  );
  const isNewCommand = ["sub", "subscribe", "activation", "activate"].includes(compactCommand);
  const unknownLifecycle = !compactLifecycle || compactLifecycle === "-";

  if (billingSuccess && (isNewLifecycle || isNewCommand || unknownLifecycle)) return "new";
  if (FAILED_STATUSES.has(String(status).trim().toLowerCase())) return "failed";
  return "other";
};

const eventTime = (item) =>
  new Date(item.createdAt || item.callbackTimestamp || item.subscriptionStartTime || item.updatedAt || 0);

const BILLABLE_TYPES = new Set(["new", "renewal", "topup"]);

export const toReportEvent = (item = {}, fallbackSource = "CGW") => {
  const source = sourceName(item, fallbackSource);
  const createdAt = eventTime(item);
  const type = classifySubscriptionEvent({ ...item, source });
  const offerCode = String(pickFirst(item.offerCode, item.planId) || INITIAL_OFFER_CODE);
  const plan = getOfferPlan(offerCode);
  const billedAmount = parseChargeAmountGhs(extractChargeCandidates(item));
  const { priceGhs, priceSource } = resolvePriceGhs({
    billedAmount,
    offerCode,
    billable: BILLABLE_TYPES.has(type),
  });
  const raw = item.rawBody || item.rawQuery || {};

  return {
    id: String(item._id || item.cgid || item.transactionId || item.requestId || ""),
    msisdn: normalizePhone(pickFirst(item.msisdn, item.phone)),
    offerCode,
    planName: plan.name,
    planType: plan.billing === "one-time" ? "topup" : "daily",
    status: String(pickFirst(item.status, item.subscriptionStatus) || ""),
    reason: String(pickFirst(item.reason) || "-"),
    lifecycle: String(pickFirst(item.lifecycle, item.subscriberLifeCycle) || "-"),
    flow: normalizeConsentFlow(item.flow, item.channel, raw.flow, raw.Flow),
    chargingAmount: billedAmount,
    priceGhs,
    priceSource,
    currency: "GHS",
    source,
    type,
    createdAt: Number.isNaN(createdAt.getTime()) ? null : createdAt.toISOString(),
    date: Number.isNaN(createdAt.getTime()) ? "" : ghanaDate(createdAt),
  };
};

const mergeEvents = (current, incoming) => {
  const currentRank = SOURCE_RANK[current.source] || 0;
  const incomingRank = SOURCE_RANK[incoming.source] || 0;
  const incomingEarlier =
    new Date(incoming.createdAt || 0).getTime() < new Date(current.createdAt || 0).getTime();
  const primary =
    incomingRank > currentRank || (incomingRank === currentRank && incomingEarlier)
      ? incoming
      : current;
  const secondary = primary === incoming ? current : incoming;
  const billedAmount = Math.max(Number(primary.chargingAmount || 0), Number(secondary.chargingAmount || 0));
  const { priceGhs, priceSource } = resolvePriceGhs({
    billedAmount,
    offerCode: primary.offerCode || secondary.offerCode,
    billable: BILLABLE_TYPES.has(primary.type),
  });

  return {
    ...primary,
    offerCode: primary.offerCode || secondary.offerCode,
    planName: primary.planName || secondary.planName,
    chargingAmount: billedAmount,
    priceGhs,
    priceSource: billedAmount > 0 ? "billed" : priceSource,
    flow:
      primary.flow && primary.flow !== "UNKNOWN"
        ? primary.flow
        : secondary.flow || primary.flow,
    lifecycle:
      primary.lifecycle && primary.lifecycle !== "-"
        ? primary.lifecycle
        : secondary.lifecycle || primary.lifecycle,
    reason:
      primary.reason && primary.reason !== "-"
        ? primary.reason
        : secondary.reason || primary.reason,
  };
};

const uniqueByKey = (events, keyFn) => {
  const grouped = new Map();
  for (const event of events) {
    const key = keyFn(event);
    if (!key) continue;
    const existing = grouped.get(key);
    grouped.set(key, existing ? mergeEvents(existing, event) : event);
  }
  return [...grouped.values()];
};

const money = (value) => Number(Number(value || 0).toFixed(2));

export const buildDailySubscriptionReport = (rawEvents = [], range) => {
  const resolved = range?.from && range?.to ? range : resolveReportRange(range || {});
  const dates = eachGhanaDate(resolved.from, resolved.to);
  const events = rawEvents
    .map((item) => toReportEvent(item, item.callbackType || item.source || "CGW"))
    .filter((item) => item.msisdn && item.date && dates.includes(item.date))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  const uniqueEvents = uniqueByKey(events, (event) => `${event.type}|${event.date}|${event.msisdn}`);
  const newSubscriptions = uniqueEvents.filter((event) => event.type === "new");
  const uniqueUsers = new Set(newSubscriptions.map((event) => event.msisdn));

  const sumPrice = (type) =>
    money(
      uniqueEvents
        .filter((event) => event.type === type)
        .reduce((sum, event) => sum + Number(event.priceGhs || 0), 0)
    );

  const counts = {
    newSubscriptions: newSubscriptions.length,
    uniqueUsers: uniqueUsers.size,
    renewals: uniqueEvents.filter((event) => event.type === "renewal").length,
    alreadySubscribed: uniqueEvents.filter((event) => event.type === "already_subscribed").length,
    churn: uniqueEvents.filter((event) => event.type === "churn").length,
    unsub: uniqueEvents.filter((event) => event.type === "unsub").length,
    topup: uniqueEvents.filter((event) => event.type === "topup").length,
    failed: uniqueEvents.filter((event) => event.type === "failed").length,
    newRevenueGhs: sumPrice("new"),
    renewalRevenueGhs: sumPrice("renewal"),
    topupRevenueGhs: sumPrice("topup"),
  };
  counts.totalBilledGhs = money(
    counts.newRevenueGhs + counts.renewalRevenueGhs + counts.topupRevenueGhs
  );

  const grouped = new Map(dates.map((date) => [date, []]));
  for (const event of newSubscriptions) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }

  const daily = dates.map((date) => {
    const subscriptions = (grouped.get(date) || []).sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const revenueGhs = money(
      subscriptions.reduce((sum, event) => sum + Number(event.priceGhs || 0), 0)
    );

    return {
      date,
      newSubscriptions: subscriptions.length,
      revenueGhs,
      subscriptions: subscriptions.map((event) => ({
        ...event,
        chargingAmount: event.priceGhs,
      })),
    };
  });

  return {
    view: resolved.view || (resolved.from === resolved.to ? "daily" : "range"),
    timezone: GHANA_TIMEZONE,
    currency: "GHS",
    plans: Object.values({
      [INITIAL_OFFER_CODE]: getOfferPlan(INITIAL_OFFER_CODE),
      [TOPUP_OFFER_CODE]: getOfferPlan(TOPUP_OFFER_CODE),
    }),
    range: {
      from: resolved.from,
      to: resolved.to,
    },
    summary: counts,
    daily,
  };
};
