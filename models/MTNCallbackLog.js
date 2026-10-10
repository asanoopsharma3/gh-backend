import { createModel } from "../db/documentModel.js";

const MTNCallbackLog = createModel({
  table: "mtn_payment_callbacks",
  columns: {
    referenceId: "reference_id",
    transactionId: "transaction_id",
    status: "status",
    resultCode: "result_code",
    resultMessage: "result_message",
    phone: "phone",
    validityDays: "validity_days",
    requestedPlan: "requested_plan",
    appliededPlan: "applied_plan",
    chargeAmount: "charge_amount",
    rawResponse: { column: "raw_response", type: "jsonb" },
  },
  required: ["transactionId", "rawResponse"],
});

export default MTNCallbackLog;
