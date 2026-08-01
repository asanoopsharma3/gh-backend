import express from "express";
import MTNPayment from "../models/MTNPayment.js";

const mtnsearchnumberrouter = express.Router();

mtnsearchnumberrouter.post("/payment-status", async (req, res) => {
  try {
    const { phone } = req.body;

   
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required in body",
      });
    }

   
    const payment = await MTNPayment.findOne({ phone });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "No payment record found for this phone number",
      });
    }


    res.status(200).json({
      success: true,
      message: "Payment status fetched successfully",
      data:payment,
    });
  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching payment status",
      error: error.message,
    });
  }
});

export default mtnsearchnumberrouter;
