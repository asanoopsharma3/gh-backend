import { createModel } from "../db/documentModel.js";

const Payment = createModel({
  table: "payments",
  columns: {
    userId: { column: "user_id", type: "id" },
    phone: "phone",
    referenceId: "reference_id",
    amount: { column: "amount", type: "number" },
    currency: { column: "currency", default: "SZL" },
    status: { column: "status", default: "PENDING" },
    reason: { column: "reason", default: null },
    payerMessage: { column: "payer_message", default: null },
    payeeNote: { column: "payee_note", default: null },
    rawResponse: { column: "raw_response", type: "jsonb", default: () => ({}) },
  },
  required: ["userId", "phone", "referenceId", "amount"],
  refs: { userId: "users" },
});

export default Payment;
