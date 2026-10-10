import { createModel } from "../db/documentModel.js";

const CGWCallback = createModel({
  table: "cgw_callbacks",
  columns: {
    method: "method",
    msisdn: "msisdn",
    offerCode: "offer_code",
    status: "status",
    cgid: "cgid",
    rawQuery: { column: "raw_query", type: "jsonb" },
    rawBody: { column: "raw_body", type: "jsonb" },
    headers: { column: "headers", type: "jsonb" },
    ip: "ip",
    userAgent: "user_agent",
  },
});

export default CGWCallback;
