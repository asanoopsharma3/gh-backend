import { createModel } from "../db/documentModel.js";

const MTNPayment = createModel({
  table: "mtn_payments",
  columns: {
    userId: { column: "user_id", type: "id" },
    phone: "phone",
    subscriptionId: "subscription_id",
    subscriptionName: "subscription_name",
    referenceId: "reference_id",
    status: { column: "status", default: "SUCCESS" },
    userUpdated: { column: "user_updated", type: "boolean", default: false },
    rawResponse: { column: "raw_response", type: "jsonb" },
  },
  required: ["userId", "phone", "subscriptionId"],
  refs: { userId: "users" },
});

export default MTNPayment;
