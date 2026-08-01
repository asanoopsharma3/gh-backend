import { getAllMtnTransaction, getMtnTransaction,getAllMtnRenewalTransaction  } from "../repository/mtnpayment.js"; // ✅ ensure .js if using ES Modules
import { getAllMtnUnsubscribeTransaction } from "../repository/mtnpayment.js";
// ✅ Get all transactions
export const getAllPaymentStatus = async (req, res) => {
  try {
    const response = await getAllMtnTransaction();
    return res.status(200).json({
      message: "All transactions found successfully",
      data: response,
      status: 200,
      error: {}
    });
  } catch (error) {
    console.error("Error in getAllPaymentStatus:", error.message);
    return res.status(500).json({ 
      message: "Error in finding transactions",
      error: error.message,
      status: 500,
      data: {}
    });
  }
};


export const getMtnTransactionstatusbyid = async (req, res) => {
  try {
    const userId = req.user?._id; 
    if (!userId) throw new Error("User ID is invalid");

    const response = await getMtnTransaction(userId);

    if (!response) {
      return res.status(404).json({
        message: "Transaction not found",
        status: 404,
        data: {},
        error: {}
      });
    }

    return res.status(200).json({
      message: "Transaction found successfully",
      status: 200,
      data: response,
      error: {}
    });
  } catch (error) {
    console.error("Error in getMtnTransactionstatusbyid:", error.message);
    return res.status(500).json({
      message: "Error in finding MTN transaction by ID",
      error: error.message,
      data: {},
      status: 500
    });
  }
};



// ✅ Get only YR (Renewal) Transactions
export const getAllRenewalTransactions = async (req, res) => {
  try {
    const response = await getAllMtnRenewalTransaction();

    return res.status(200).json({
      message: "All renewal transactions found successfully",
      data: response,
      status: 200,
      error: {}
    });

  } catch (error) {
    console.error("Error in getAllRenewalTransactions:", error.message);

    return res.status(500).json({
      message: "Error in finding renewal transactions",
      error: error.message,
      status: 500,
      data: {}
    });
  }
};


export const getAllUnsubscribeTransactions = async (req, res) => {
  try {
    const response = await getAllMtnUnsubscribeTransaction();

    return res.status(200).json({
      message: "All unsubscribe transactions found successfully",
      data: response,
      status: 200,
      error: {}
    });

  } catch (error) {
    return res.status(500).json({
      message: "Error fetching unsubscribe transactions",
      error: error.message,
      status: 500,
      data: {}
    });
  }
};
