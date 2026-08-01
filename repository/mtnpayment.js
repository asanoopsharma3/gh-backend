import MTNPayment from "../models/MTNPayment.js";

import MTNCallbackLog from "../models/MTNCallbackLog.js";

export const getMtnTransaction = async(userId)=>{
    try{
     const gettransaction =await MTNPayment.findOne({userId})
     return gettransaction;
    }catch(error){
        console.log("error in finding user payement status")
        throw error;
    }
}
export const getAllMtnTransaction = async()=>{
    try{
        const getalltransaction = await MTNPayment.find();
        return getalltransaction;
    }catch(error){
        console.log("error in find  getAllMtnTransaction  repository ");
        throw error;
    }
}

// ✅ Get Only Renewal (YR)
export const getAllMtnRenewalTransaction = async () => {
  return await MTNPayment.find({
    "rawResponse.operationId": "YR",
    status: "SUCCESS"
  }).sort({ createdAt: -1 });
};

export const getAllMtnUnsubscribeTransaction = async () => {
  return await MTNCallbackLog.find({
    "rawResponse.operationId": "ACI"
  }).sort({ createdAt: -1 });
};