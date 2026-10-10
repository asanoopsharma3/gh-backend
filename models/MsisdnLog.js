import { createModel } from "../db/documentModel.js";

const MsisdnLog = createModel({
  table: "msisdn_logs",
  columns: {
    msisdn: "msisdn",
    source: { column: "source", default: "HE" },
    offerCode: "offer_code",
    ip: "ip",
    userAgent: "user_agent",
  },
});

export default MsisdnLog;
