import mongoose from "mongoose";

const sdpLogSchema = new mongoose.Schema(
  {
    method: String,
    externalServiceId: String,
    requestId: { type: String, index: true },
    requestTimeStamp: String,
    channel: String,
    featureId: String,
    planId: String,
    command: String,
    msisdn: { type: String, index: true },
    offerCode: String,
    chargeAmount: { type: Number, default: 0 },
    subscriptionStatus: String,
    subscriberLifeCycle: String,
    transactionId: { type: String, index: true },
    nextBillingDate: String,
    reason: String,
    normalizedStatus: String,
    operator: String,
    callbackTimestamp: { type: Date, default: Date.now, index: true },
    payloadJson: mongoose.Schema.Types.Mixed,
    rawQuery: mongoose.Schema.Types.Mixed,
    rawBody: mongoose.Schema.Types.Mixed,
    headers: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: true, collection: "sdplog" }
);

export default mongoose.model("SDPLog", sdpLogSchema);
