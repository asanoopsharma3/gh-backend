import { createModel } from "../db/documentModel.js";

const SDPCallback = createModel({
  table: "sdp_callbacks",
  columns: {
    method: "method",
    msisdn: "msisdn",
    transactionId: "transaction_id",
    offerCode: "offer_code",
    status: "status",
    operator: "operator",
    operatorResponse: { column: "operator_response", type: "jsonb" },
    callbackTimestamp: { column: "callback_timestamp", type: "date", default: () => new Date() },
    payloadJson: { column: "payload_json", type: "jsonb" },
    lifecycle: "lifecycle",
    reason: "reason",
    rawQuery: { column: "raw_query", type: "jsonb" },
    rawBody: { column: "raw_body", type: "jsonb" },
    headers: { column: "headers", type: "jsonb" },
    ip: "ip",
    userAgent: "user_agent",
  },
});

export default SDPCallback;
