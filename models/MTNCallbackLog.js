import mongoose from "mongoose";

const mtnCallbackSchema = new mongoose.Schema(
  {
    referenceId: {
      type: String,
      index: true,
    },

    // 🔑 MAIN UNIQUE KEY (sequenceNo)
    transactionId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },

    // SUCCESS / FAILED
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED"],
    },

    // MTN response fields
    resultCode: String,
    resultMessage: String,

    phone: String,

    validityDays: String,
    requestedPlan: String,
    appliededPlan: String,
    chargeAmount: String,

    // Full callback payload
    rawResponse: {
      type: Object,
      required: true,
    },
  },
  { timestamps: true }
);

const MTNCallbackLog = mongoose.model(
  "mtnpaymentcallbacks",
  mtnCallbackSchema
);

export default MTNCallbackLog;
