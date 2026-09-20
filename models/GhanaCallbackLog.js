import mongoose from "mongoose";

const ghanaCallbackLogSchema = new mongoose.Schema(
  {
    callbackType: { type: String, enum: ["SDP", "CGW"], required: true },
    flow: { type: String, enum: ["HE", "NHE", "UNKNOWN"], default: "UNKNOWN" },
    method: String,
    msisdn: String,
    offerCode: String,
    status: String,
    normalizedStatus: String,
    lifecycle: String,
    reason: String,
    cgid: String,
    chargingAmount: { type: Number, default: 0 },
    rawQuery: mongoose.Schema.Types.Mixed,
    rawBody: mongoose.Schema.Types.Mixed,
    headers: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: true, collection: "ghanacallbacklogs" }
);

ghanaCallbackLogSchema.index({ createdAt: -1 });
ghanaCallbackLogSchema.index({ callbackType: 1, createdAt: -1 });

export default mongoose.model("GhanaCallbackLog", ghanaCallbackLogSchema);
