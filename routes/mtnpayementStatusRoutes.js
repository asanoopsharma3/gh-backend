import express from "express";
import { 
  getAllPaymentStatus, 
  getMtnTransactionstatusbyid, 
  getAllRenewalTransactions 
} from "../controllers/MtnTransactionstatus.js";

import { getAllUnsubscribeTransactions } from "../controllers/MtnTransactionstatus.js";

import { protect } from "../middleware/authMiddleware.js";

const mtnpaymentrouter = express.Router();

// ✅ All transactions
mtnpaymentrouter.get('/status', protect, getAllPaymentStatus);

// ✅ Transaction by user
mtnpaymentrouter.get('/statusbyid', protect, getMtnTransactionstatusbyid);

// ✅ 🔁 Renewal transactions only
mtnpaymentrouter.get('/mtn-renewals', getAllRenewalTransactions);

mtnpaymentrouter.get("/mtn-unsubscribe", getAllUnsubscribeTransactions);

export default mtnpaymentrouter;