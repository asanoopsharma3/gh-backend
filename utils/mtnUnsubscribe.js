import axios from "axios";
import { randomUUID } from "crypto";
import { getMtnAccessToken } from "./mtn.js";
import { INITIAL_OFFER_CODE } from "../config/cgwconfig.js";
import { logUnsubscribe } from "./unsubscribeLog.js";

const DEFAULT_UNSUBSCRIBE_BASE_URL = "https://api.mtn.com/v2/customers";

export class MtnUnsubscribeError extends Error {
  constructor(message, { statusCode = 502, mtn = null } = {}) {
    super(message);
    this.name = "MtnUnsubscribeError";
    this.statusCode = statusCode;
    this.mtn = mtn;
  }
}

export const getUnsubscribeSubscriptionId = () =>
  process.env.MTN_SUBSCRIPTION_ID ||
  process.env.CGW_INITIAL_OFFER_CODE ||
  INITIAL_OFFER_CODE;

export const getUnsubscribeSubscriptionProviderId = () =>
  String(process.env.MTN_SUBSCRIPTION_PROVIDER_ID || "").trim();

export const getUnsubscribeApiKey = () =>
  String(process.env.MTN_X_API_KEY || process.env.MTN_CLIENT_ID || "").trim();

export const toMtnCustomerId = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
};

const unsubscribeBaseUrl = () =>
  String(process.env.MTN_UNSUBSCRIBE_BASE_URL || DEFAULT_UNSUBSCRIBE_BASE_URL).replace(
    /\/+$/,
    ""
  );

export const buildMtnUnsubscribeUrl = (customerId, subscriptionId) =>
  `${unsubscribeBaseUrl()}/${encodeURIComponent(customerId)}/subscriptions/${encodeURIComponent(
    subscriptionId
  )}`;

export const buildMtnSubscriptionsUrl = (customerId) =>
  `${unsubscribeBaseUrl()}/${encodeURIComponent(customerId)}/subscriptions`;

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === "";

const asText = (value) => {
  if (isBlank(value)) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const extractProviderIdFromSubscriptions = (payload, subscriptionId) => {
  const target = String(subscriptionId || "").trim();
  if (!payload || typeof payload !== "object" || !target) return "";

  const matches = [];

  const visit = (node) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const nodeSubscriptionId = node.subscriptionId ?? node.SubscriptionId;
    const nodeProviderId =
      node.subscriptionProviderId ?? node.SubscriptionProviderId;

    if (!isBlank(nodeSubscriptionId) && String(nodeSubscriptionId) === target && !isBlank(nodeProviderId)) {
      matches.push(String(nodeProviderId).trim());
    }

    Object.values(node).forEach(visit);
  };

  visit(payload);
  return matches[0] || "";
};

export const isMtnUnsubscribeSuccess = (payload, httpStatus) => {
  if (httpStatus === 404) return true;
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (!payload || typeof payload !== "object") return true;

  const statusCode = payload.statusCode;
  if (statusCode !== undefined && statusCode !== null && String(statusCode) !== "") {
    return Number(statusCode) === 0;
  }

  return /success/i.test(String(payload.status || payload.description || ""));
};

export const shouldSkipMtnUnsubscribe = () =>
  process.env.MTN_UNSUBSCRIBE_SKIP === "true";

const buildMtnHeaders = (token, transactionId) => {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    transactionId,
  };
  const apiKey = getUnsubscribeApiKey();
  if (apiKey) headers["X-API-Key"] = apiKey;
  const countryCode = String(process.env.MTN_COUNTRY_CODE || "GH").trim();
  if (countryCode) headers["x-country-code"] = countryCode;
  return headers;
};

const describeMtnError = (payload, httpStatus) => {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (payload && typeof payload === "object") {
    return (
      payload.description ||
      payload.message ||
      payload.status ||
      payload.error ||
      asText(payload)
    );
  }
  return `MTN unsubscribe failed with HTTP ${httpStatus}`;
};

async function lookupSubscriptionProviderId({
  customerId,
  subscriptionId,
  headers,
}) {
  const configured = getUnsubscribeSubscriptionProviderId();
  if (configured) {
    logUnsubscribe("provider-from-env", { subscriptionProviderId: configured });
    return configured;
  }

  const lookupUrl = buildMtnSubscriptionsUrl(customerId);
  logUnsubscribe("provider-lookup-request", { method: "GET", url: lookupUrl });

  let response;
  try {
    response = await axios.get(lookupUrl, {
      headers,
      timeout: 20000,
      validateStatus: () => true,
    });
  } catch (error) {
    logUnsubscribe("provider-lookup-network-error", { error: error.message });
    throw new MtnUnsubscribeError("Unable to reach MTN subscription lookup API.", {
      statusCode: 502,
      mtn: { description: error.message, customerId, subscriptionId },
    });
  }

  const payload = response.data;
  logUnsubscribe("provider-lookup-response", {
    httpStatus: response.status,
    body: payload,
  });
  const providerId = extractProviderIdFromSubscriptions(payload, subscriptionId);
  if (providerId) return providerId;

  throw new MtnUnsubscribeError(
    "subscriptionProviderId is required by MTN Subscriptions v2 and could not be resolved. Set MTN_SUBSCRIPTION_PROVIDER_ID to the provider host id (not the offer/subscription id).",
    {
      statusCode: 502,
      mtn: {
        customerId,
        subscriptionId,
        httpStatus: response.status,
        description: describeMtnError(payload, response.status),
      },
    }
  );
}

export async function callMtnUnsubscribe(
  phone,
  { subscriptionId, subscriptionProviderId, transactionId } = {}
) {
  const customerId = toMtnCustomerId(phone);
  const offerId = String(subscriptionId || getUnsubscribeSubscriptionId());
  const txnId = transactionId || randomUUID();

  if (!customerId) {
    logUnsubscribe("missing-customer-id", { phone });
    throw new MtnUnsubscribeError("Subscriber mobile number is missing for MTN unsubscribe.");
  }

  if (!offerId) {
    logUnsubscribe("missing-subscription-id");
    throw new MtnUnsubscribeError("subscriptionId cannot be empty");
  }

  logUnsubscribe("start", {
    phone,
    customerId,
    subscriptionId: offerId,
    transactionId: txnId,
    subscriptionProviderId:
      subscriptionProviderId || getUnsubscribeSubscriptionProviderId() || null,
    skip: shouldSkipMtnUnsubscribe(),
  });

  if (shouldSkipMtnUnsubscribe()) {
    const skippedProvider =
      String(subscriptionProviderId || getUnsubscribeSubscriptionProviderId() || "").trim();
    logUnsubscribe("skipped-local-mode", { customerId, subscriptionId: offerId });
    return {
      skipped: true,
      customerId,
      subscriptionId: offerId,
      subscriptionProviderId: skippedProvider || null,
      transactionId: txnId,
      statusCode: 0,
      status: "Unsubscribe successful",
      description: "MTN unsubscribe skipped in local mode.",
    };
  }

  let token;
  try {
    token = await getMtnAccessToken();
  } catch (error) {
    logUnsubscribe("token-failed", { error: error.message, customerId });
    throw new MtnUnsubscribeError("Failed to get MTN access token", {
      statusCode: 502,
      mtn: { description: error.message, customerId, subscriptionId: offerId },
    });
  }
  const headers = buildMtnHeaders(token, txnId);
  const providerId = String(
    subscriptionProviderId ||
      (await lookupSubscriptionProviderId({
        customerId,
        subscriptionId: offerId,
        headers,
      }))
  ).trim();

  if (!providerId) {
    logUnsubscribe("empty-provider-id", { customerId, subscriptionId: offerId });
    throw new MtnUnsubscribeError("subscriptionProviderId cannot be empty");
  }

  const url = buildMtnUnsubscribeUrl(customerId, offerId);
  logUnsubscribe("mtn-delete-request", {
    method: "DELETE",
    url: `${url}?subscriptionProviderId=${encodeURIComponent(providerId)}`,
    customerId,
    subscriptionId: offerId,
    subscriptionProviderId: providerId,
    transactionId: txnId,
    xApiKeySet: Boolean(getUnsubscribeApiKey()),
  });

  let response;
  try {
    response = await axios.delete(url, {
      headers,
      params: { subscriptionProviderId: providerId },
      timeout: 20000,
      validateStatus: () => true,
    });
  } catch (error) {
    logUnsubscribe("mtn-delete-network-error", { error: error.message, url });
    throw new MtnUnsubscribeError("Unable to reach MTN unsubscribe API.", {
      statusCode: 502,
      mtn: { description: error.message, customerId, subscriptionId: offerId, subscriptionProviderId: providerId },
    });
  }

  const payload = response.data && typeof response.data === "object" ? response.data : response.data;
  logUnsubscribe("mtn-delete-response", {
    httpStatus: response.status,
    body: payload,
  });
  const mtn = {
    customerId,
    subscriptionId:
      payload && typeof payload === "object" ? payload.subscriptionId ?? offerId : offerId,
    subscriptionProviderId:
      payload && typeof payload === "object"
        ? payload.subscriptionProviderId ?? providerId
        : providerId,
    statusCode:
      payload && typeof payload === "object" ? payload.statusCode ?? response.status : response.status,
    status: payload && typeof payload === "object" ? payload.status || "" : "",
    description: describeMtnError(payload, response.status),
    transactionId: txnId,
    httpStatus: response.status,
  };

  if (!isMtnUnsubscribeSuccess(payload && typeof payload === "object" ? payload : null, response.status)) {
    logUnsubscribe("mtn-delete-failed", mtn);
    throw new MtnUnsubscribeError(
      mtn.status || mtn.description || "MTN unsubscribe failed.",
      { statusCode: 502, mtn }
    );
  }

  logUnsubscribe("mtn-delete-success", mtn);
  return {
    skipped: false,
    ...mtn,
    status: mtn.status || "Unsubscribe successful",
    description:
      payload && typeof payload === "object" && payload.description
        ? payload.description
        : "Unsubscribe successful",
  };
}
