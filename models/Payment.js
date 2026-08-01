import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
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
    referenceId: {
      type: String,
      required: true,
      unique: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "SZL",
    },
    status: {
  type: String,
  enum: ["PENDING", "CREATED", "SUCCESSFUL", "FAILED"],
  default: "PENDING"
},
    reason: {
      type: String,
      default: null,
    },
    payerMessage: {
      type: String,
      default: null,
    },
    payeeNote: {
      type: String,
      default: null,
    },
    rawResponse: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true, 
  }
);

export default mongoose.model("Payment", paymentSchema);
