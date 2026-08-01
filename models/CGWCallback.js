import mongoose from "mongoose";

const cgwCallbackSchema = new mongoose.Schema(
  {
    method: String,
    msisdn: String,
    offerCode: String,
    status: String,
    cgid: String,
    rawQuery: mongoose.Schema.Types.Mixed,
    rawBody: mongoose.Schema.Types.Mixed,
    headers: mongoose.Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: true, collection: "cgwcallbacks" }
);

export default mongoose.model("CGWCallback", cgwCallbackSchema);
