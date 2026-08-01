import mongoose from "mongoose";

const mtnPaymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    subscriptionId: {
      type: String,
      required: true,
    },
    subscriptionName: {
      type: String,
    },
    referenceId: {
      type: String, // MTN API se milne wala unique reference ID
    },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "SUCCESS",
    },
    userUpdated: {
      type: Boolean,
      default: false,
    },
    rawResponse: {
      type: Object, // pure MTN API ka response save karne ke liye
    },
  },
  { timestamps: true }
);

const MTNPayment = mongoose.model("MTNPayment", mtnPaymentSchema);
export default MTNPayment;
