import mongoose from "mongoose";

const sdpCallbackSchema = new mongoose.Schema(
  {
    method: String,
    msisdn: String,
    transactionId: { type: String, index: true },
    offerCode: String,
    status: String,
    operator: String,
    operatorResponse: mongoose.Schema.Types.Mixed,
    callbackTimestamp: { type: Date, default: Date.now, index: true },
    payloadJson: mongoose.Schema.Types.Mixed,
    lifecycle: String,
    reason: String,
    rawQuery: mongoose.Schema.Types.Mixed,
    rawBody: mongoose.Schema.Types.Mixed,
    headers: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: true, collection: "sdp_callbacks" }
);

export default mongoose.model("SDPCallback", sdpCallbackSchema);
