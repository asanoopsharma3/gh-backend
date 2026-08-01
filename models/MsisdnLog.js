import mongoose from "mongoose";

const msisdnLogSchema = new mongoose.Schema(
  {
    msisdn: String,
    source: { type: String, default: "HE" },
    offerCode: String,
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

export default mongoose.model("MsisdnLog", msisdnLogSchema);
