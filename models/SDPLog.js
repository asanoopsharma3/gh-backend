import { createModel } from "../db/documentModel.js";

const SDPLog = createModel({
  table: "sdp_logs",
  columns: {
    method: "method",
    externalServiceId: "external_service_id",
    requestId: "request_id",
    requestTimeStamp: "request_timestamp",
    channel: "channel",
    featureId: "feature_id",
    planId: "plan_id",
    command: "command",
    msisdn: "msisdn",
    offerCode: "offer_code",
    chargeAmount: { column: "charge_amount", type: "number", default: 0 },
    subscriptionStatus: "subscription_status",
    subscriberLifeCycle: "subscriber_life_cycle",
    transactionId: "transaction_id",
    nextBillingDate: "next_billing_date",
    reason: "reason",
    normalizedStatus: "normalized_status",
    operator: "operator",
    callbackTimestamp: { column: "callback_timestamp", type: "date", default: () => new Date() },
    payloadJson: { column: "payload_json", type: "jsonb" },
    rawQuery: { column: "raw_query", type: "jsonb" },
    rawBody: { column: "raw_body", type: "jsonb" },
    headers: { column: "headers", type: "jsonb" },
    ip: "ip",
    userAgent: "user_agent",
  },
});

export default SDPLog;
