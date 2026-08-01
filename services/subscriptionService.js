import User from "../models/User.js";

export const DAILY_QUESTION_LIMIT = 10;
export const SUBSCRIPTION_CYCLE_MS = 24 * 60 * 60 * 1000;
export const LIMIT_REACHED_MESSAGE =
  "Your 10 question set is completed. Please top up to continue.";

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
