import User from "../models/User.js";
import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import MTNCallbackLog from "../models/MTNCallbackLog.js";
import SDPCallback from "../models/SDPCallback.js";
import { callMtnUnsubscribe } from "../utils/mtnUnsubscribe.js";

export const DAILY_QUESTION_LIMIT = 10;
export const SUBSCRIPTION_CYCLE_MS = 24 * 60 * 60 * 1000;
export const LIMIT_REACHED_MESSAGE =
  "You have exhausted your 10 set of questions for the day. Please top up to get additional 10 set of questions.";

export const TOPUP_REQUIRED_MESSAGE = LIMIT_REACHED_MESSAGE;

const addCycle = (date) => new Date(date.getTime() + SUBSCRIPTION_CYCLE_MS);

export const calculateCycleState = (user, now = new Date()) => {
  if (!user) {
    throw new TypeError("Subscription user is required");
  }

  if (user.subscriptionStatus !== "active") {
    return {
      shouldReset: false,
      subscriptionStatus: user.subscriptionStatus || "inactive",
      questionsPlayedToday: user.questionsPlayedToday || 0,
      subscriptionStartTime: user.subscriptionStartTime || null,
      nextPlayTime: user.nextPlayTime || null,
    };
  }

  let subscriptionStartTime = user.subscriptionStartTime
    ? new Date(user.subscriptionStartTime)
    : new Date(now);
  let nextPlayTime = user.nextPlayTime
    ? new Date(user.nextPlayTime)
    : addCycle(subscriptionStartTime);
  let shouldReset = false;

  while (nextPlayTime <= now) {
    subscriptionStartTime = new Date(nextPlayTime);
    nextPlayTime = addCycle(nextPlayTime);
    shouldReset = true;
  }

  return {
    shouldReset,
    subscriptionStatus: "active",
    questionsPlayedToday: shouldReset ? 0 : user.questionsPlayedToday || 0,
    subscriptionStartTime,
    nextPlayTime,
  };
};

export const refreshSubscriptionCycle = async (user, now = new Date()) => {
  const state = calculateCycleState(user, now);

  user.subscriptionStatus = state.subscriptionStatus;
  user.questionsPlayedToday = state.questionsPlayedToday;
  user.subscriptionStartTime = state.subscriptionStartTime;
  user.nextPlayTime = state.nextPlayTime;

  if (state.shouldReset) {
    user.isAttemptQuiz = false;
  }

  await user.save();
  return user;
};

export const setSubscriptionStatus = async (user, status) => {
  user.subscriptionStatus = status;
  if (status !== "active") {
    user.isAttemptQuiz = true;
  }
  await user.save();
  return user;
};

export const normalizeSubscriptionMsisdn = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return `233${digits.slice(1)}`;
  return `233${digits}`;
};

export const activateSubscriptionByMsisdn = async (msisdn) => {
  const normalized = normalizeSubscriptionMsisdn(msisdn);
  if (!normalized || normalized.length < 12) {
    throw new Error("Invalid MSISDN format. Expected format: 233XXXXXXXXX");
  }

  const phone = `+${normalized}`;
  let user = await User.findOne({ $or: [{ phone }, { phone: normalized }] });
  if (!user) {
    user = await User.create({ phone });
  }

  user.subscriptionStatus = "active";
  user.isAttemptQuiz = false;
  user.unsubscribedAt = null;
  user.lastUnsubscribe = undefined;
  user.markModified("lastUnsubscribe");
  if (!user.subscriptionStartTime) {
    user.subscriptionStartTime = new Date();
    user.nextPlayTime = new Date(Date.now() + SUBSCRIPTION_CYCLE_MS);
  }
  await user.save();
  return user;
};

export const unsubscribeUser = async (user) => {
  if (!user) {
    throw new TypeError("Subscription user is required");
  }

  const now = new Date();
  const alreadyInactive = user.subscriptionStatus !== "active";
  const mtn = alreadyInactive
    ? {
        skipped: true,
        statusCode: 0,
        status: "Already unsubscribed",
        description: "Number was already inactive. Session was cleared.",
        customerId: user.phone,
      }
    : await callMtnUnsubscribe(user.phone);

  user.subscriptionStatus = "inactive";
  user.isAttemptQuiz = true;
  user.questionsPlayedToday = 0;
  user.unsubscribedAt = now;
  user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  user.otp = undefined;
  user.otpExpiry = undefined;
  user.lastOtpSent = undefined;
  user.verifyAttempts = 0;
  user.isPhoneVerified = false;
  user.lastUnsubscribe = {
    statusCode: mtn.statusCode ?? 0,
    status: mtn.status || "Unsubscribe successful",
    description: mtn.description || "",
    subscriptionId: mtn.subscriptionId ?? null,
    subscriptionProviderId: mtn.subscriptionProviderId ?? null,
    transactionId: mtn.transactionId || "",
    customerId: mtn.customerId || "",
    at: now,
  };
  await user.save();

  const msisdn = normalizeSubscriptionMsisdn(user.phone) || String(user.phone || "");
  const transactionId = mtn.transactionId || `WEB-UNSUB-${user._id}-${now.getTime()}`;
  const mtnStatus = mtn.status || "Unsubscribe successful";
  const mtnDescription = mtn.description || mtnStatus;
  const rawResponse = {
    operationId: "ACI",
    result: mtnStatus,
    description: mtnDescription,
    statusCode: mtn.statusCode ?? 0,
    subscriptionId: mtn.subscriptionId ?? null,
    subscriptionProviderId: mtn.subscriptionProviderId ?? null,
    source: "WEB",
    phone: user.phone,
    customerId: mtn.customerId || msisdn,
    tokenVersion: user.tokenVersion,
    skipped: Boolean(mtn.skipped),
  };

  await MTNCallbackLog.create({
    transactionId: `WEB-UNSUB-${transactionId}`,
    referenceId: transactionId,
    status: "SUCCESS",
    resultCode: String(mtn.statusCode ?? 0),
    resultMessage: mtnStatus,
    phone: user.phone,
    requestedPlan: "UNSUBSCRIBE",
    appliededPlan: "UNSUBSCRIBE",
    rawResponse,
  }).catch((error) => {
    console.error("Unsubscribe MTN callback log error:", error.message);
  });

  await SDPCallback.create({
    method: "DELETE",
    msisdn,
    transactionId,
    status: mtnStatus,
    lifecycle: "UNSUB",
    reason: mtnDescription,
    operator: "MTN Ghana",
    operatorResponse: mtn,
    callbackTimestamp: now,
    payloadJson: rawResponse,
  }).catch((error) => {
    console.error("Unsubscribe SDP callback log error:", error.message);
  });

  await GhanaCallbackLog.create({
    callbackType: "SDP",
    flow: "UNKNOWN",
    method: "DELETE",
    msisdn,
    status: mtnStatus,
    normalizedStatus: "unsubscribed",
    lifecycle: "UNSUB",
    reason: mtnDescription,
    rawBody: rawResponse,
  }).catch((error) => {
    console.error("Unsubscribe Ghana callback log error:", error.message);
  });

  return {
    user,
    alreadyInactive,
    msisdn: user.phone,
    mtn,
    subscription: getSubscriptionSummary(user),
  };
};

export const getSubscriptionSummary = (user) => {
  const used = Math.min(
    Math.max(Number(user.questionsPlayedToday || 0), 0),
    DAILY_QUESTION_LIMIT
  );

  return {
    subscriptionStatus: user.subscriptionStatus || "inactive",
    quizAccessStatus: user.isAttemptQuiz ? "topup_required" : "available",
    questionsPlayedToday: used,
    questionsRemaining: Math.max(DAILY_QUESTION_LIMIT - used, 0),
    dailyQuestionLimit: DAILY_QUESTION_LIMIT,
    subscriptionStartTime: user.subscriptionStartTime || null,
    nextPlayTime: user.nextPlayTime || null,
    canPlay:
      user.subscriptionStatus === "active" && !user.isAttemptQuiz,
    limitReached:
      user.subscriptionStatus === "active" && user.isAttemptQuiz,
    message:
      user.subscriptionStatus !== "active"
        ? "Subscription inactive. Please subscribe again."
        : user.isAttemptQuiz
          ? LIMIT_REACHED_MESSAGE
          : "You can play your 10 question set.",
  };
};

export const consumeQuestion = async (userId, now = new Date()) => {
  const user = await User.findById(userId);
  if (!user) return { error: "USER_NOT_FOUND" };

  await refreshSubscriptionCycle(user, now);

  if (user.subscriptionStatus !== "active") {
    return { error: "SUBSCRIPTION_REQUIRED", user };
  }

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      subscriptionStatus: "active",
      questionsPlayedToday: { $lt: DAILY_QUESTION_LIMIT },
      nextPlayTime: { $gt: now },
    },
    { $inc: { questionsPlayedToday: 1 } },
    { new: true }
  );

  if (!updatedUser) {
    return { error: "LIMIT_REACHED", user: await User.findById(userId) };
  }

  return { user: updatedUser };
};
