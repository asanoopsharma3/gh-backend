import mongoose from "mongoose";

const cgwCallbackLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["CGW", "SDP"], default: "CGW" },
    method: String,
    msisdn: String,
    offerCode: String,
    status: String,
    lifecycle: String,
    reason: String,
    cgid: String,
    rawQuery: mongoose.Schema.Types.Mixed,
    rawBody: mongoose.Schema.Types.Mixed,
    headers: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

export default mongoose.model("CGWCallbackLog", cgwCallbackLogSchema);
