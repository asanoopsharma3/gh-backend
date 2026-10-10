import { createModel } from "../db/documentModel.js";

const GhanaCallbackLog = createModel({
  table: "ghana_callback_logs",
  columns: {
    callbackType: "callback_type",
    flow: { column: "flow", default: "UNKNOWN" },
    method: "method",
    msisdn: "msisdn",
    offerCode: "offer_code",
    status: "status",
    normalizedStatus: "normalized_status",
    lifecycle: "lifecycle",
    reason: "reason",
    cgid: "cgid",
    chargingAmount: { column: "charging_amount", type: "number", default: 0 },
    rawQuery: { column: "raw_query", type: "jsonb" },
    rawBody: { column: "raw_body", type: "jsonb" },
    headers: { column: "headers", type: "jsonb" },
    ip: "ip",
    userAgent: "user_agent",
  },
  required: ["callbackType"],
});

export default GhanaCallbackLog;