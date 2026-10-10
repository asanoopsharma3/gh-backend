import { createModel } from "../db/documentModel.js";

const CGWCallbackLog = createModel({
  table: "cgw_callback_logs",
  columns: {
    type: { column: "type", default: "CGW" },
    method: "method",
    msisdn: "msisdn",
    offerCode: "offer_code",
    status: "status",
    lifecycle: "lifecycle",
    reason: "reason",
    cgid: "cgid",
    rawQuery: { column: "raw_query", type: "jsonb" },
    rawBody: { column: "raw_body", type: "jsonb" },
    headers: { column: "headers", type: "jsonb" },
    ip: "ip",
    userAgent: "user_agent",
  },
});

export default CGWCallbackLog;
