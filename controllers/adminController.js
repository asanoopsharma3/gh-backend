import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import SDPLog from "../models/SDPLog.js";
import csv from "csv-parser";
import fs from "fs";
import {
  calculateCycleState,
  DAILY_QUESTION_LIMIT,
} from "../services/subscriptionService.js";

const startOfDay = (date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfDay = (date) => {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
};

const buildDateFilter = (date) => {
  if (!date) return {};
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return {};
  return { createdAt: { $gte: startOfDay(parsed), $lte: endOfDay(parsed) } };
};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "") || "";

const getNested = (source, paths) => {
  for (const path of paths) {
    const value = path.split(".").reduce((obj, part) => (obj ? obj[part] : undefined), source);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
};

const normalizeStatus = (status = "", reason = "", lifecycle = "") => {
  const statusText = String(status).toLowerCase();
  const reasonText = String(reason).toLowerCase();
  const lifecycleText = String(lifecycle).toLowerCase();

  if (
    reasonText.includes("insufficient") ||
    reasonText.includes("low balance") ||
    reasonText.includes("churn") ||
    ["2", "26", "29", "55", "63", "111"].includes(statusText)
  ) {
    return "churn";
  }

  if (lifecycleText.includes("ren") || reasonText.includes("renew")) return "renewal";
  if (["success", "successful", "active", "a", "200", "9", "115"].includes(statusText)) {
    return "success";
  }
  if (["failed", "failure", "fail", "deactivated", "d", "suspended", "s", "1", "11", "12", "13", "91", "150", "186", "644"].includes(statusText)) {
    return "failed";
  }

  return statusText || "unknown";
};

const normalizeEvent = (item, source = "Ghana Callback") => {
  const raw = item.rawResponse || item.rawQuery || item.rawBody || item.rawData || {};
  const reason = pickFirst(
    item.reason,
    item.resultMessage,
    getNested(raw, ["reason", "Reason", "message", "Message", "statusMessage", "status_message"])
  );
  const lifecycle = pickFirst(item.lifecycle, getNested(raw, ["lifecycle", "Lifecycle", "event", "Event"]));
  const statusValue = pickFirst(item.status, item.resultCode, getNested(raw, ["status", "Status", "resultCode"]));
  const status = normalizeStatus(statusValue, reason, lifecycle);
  const msisdn = pickFirst(item.msisdn, item.phone, getNested(raw, ["msisdn", "MSISDN", "ani", "phone", "mobileNumber"]));
  const amount = Number(
    pickFirst(item.chargeAmount, getNested(raw, ["chargingAmount", "charging_amount", "amount", "Amount", "chargeAmount"]))
  ) || 0;

  return {
    id: String(item._id || item.cgid || item.referenceId || item.transactionId || ""),
    msisdn,
    offerCode: pickFirst(item.offerCode, getNested(raw, ["offerCode", "OfferCode", "offerid", "offerId"])),
    reason: reason || "-",
    nextBillingDate: pickFirst(getNested(raw, ["nextBillingDate", "next_billing_date", "NextBillingDate"])),
    status,
    rawStatus: statusValue || "-",
    chargingAmount: amount,
    lifecycle: lifecycle || "-",
    source,
    createdAt: item.createdAt || item.updatedAt,
  };
};

const matchesReport = (item, report) => {
  if (!report || report === "all") return true;
  if (report === "success") return item.status === "success";
  if (report === "renewal") return item.status === "renewal";
  if (report === "churn") return item.status === "churn";
  if (report === "failed") return item.status === "failed";
  return true;
};

const matchesSearch = (item, search = "") => {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [item.msisdn, item.offerCode, item.status, item.rawStatus, item.reason, item.source, item.lifecycle]
    .some((value) => String(value || "").toLowerCase().includes(term));
};

const getAdminEvents = async ({ date, report, search } = {}) => {
  const filter = buildDateFilter(date);
  const [callbacks, sdpLogs] = await Promise.all([
    GhanaCallbackLog.find({ ...filter, callbackType: { $ne: "SDP" } }).sort({ createdAt: -1 }).lean(),
    SDPLog.find(filter).sort({ createdAt: -1 }).lean(),
  ]);

  const cgwEvents = callbacks.map((item) => ({
    id: String(item._id || item.cgid || ""),
    msisdn: item.msisdn || "",
    offerCode: item.offerCode || "",
    reason: item.reason || "-",
    nextBillingDate: "",
    status: item.normalizedStatus || normalizeStatus(item.status, item.reason, item.lifecycle),
    rawStatus: item.status || "-",
    chargingAmount: Number(item.chargingAmount || 0),
    lifecycle: item.lifecycle || "-",
    source: item.callbackType === "SDP" ? "SDP Callback" : "CGW Callback",
    flow: item.flow || "UNKNOWN",
    cgid: item.cgid || "",
    createdAt: item.createdAt || item.updatedAt,
  }));

  const sdpEvents = sdpLogs.map((item) => ({
    id: String(item._id || item.transactionId || item.requestId || ""),
    msisdn: item.msisdn || "",
    offerCode: item.offerCode || item.planId || "",
    reason: item.reason || "-",
    nextBillingDate: item.nextBillingDate || "",
    status:
      item.normalizedStatus ||
      normalizeStatus(item.subscriptionStatus, item.reason, item.subscriberLifeCycle),
    rawStatus: item.subscriptionStatus || "-",
    chargingAmount: Number(item.chargeAmount || 0),
    lifecycle: item.subscriberLifeCycle || "-",
    source: "SDP Callback",
    flow: item.channel || "SDP",
    cgid: "",
    transactionId: item.transactionId || "",
    requestId: item.requestId || "",
    createdAt: item.createdAt || item.callbackTimestamp,
  }));

  const events = [...sdpEvents, ...cgwEvents];

  return events
    .filter((item) => matchesReport(item, report))
    .filter((item) => matchesSearch(item, search))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};

const buildSummary = async (events) => {
  const subscriberKeys = new Set(
    events
      .filter((item) => item.status === "success" || item.status === "renewal")
      .map((item) => item.msisdn)
      .filter(Boolean)
  );

  const activeSubscriptions = await User.countDocuments({
    subscriptionStatus: "active",
  });
  const usageTotals = await User.aggregate([
    { $match: { subscriptionStatus: "active" } },
    { $group: { _id: null, questionsUsed: { $sum: "$questionsPlayedToday" } } },
  ]);

  return {
    totalEvents: events.length,
    totalSubscribers: subscriberKeys.size,
    totalUsers: await User.countDocuments(),
    success: events.filter((item) => item.status === "success").length,
    renewals: events.filter((item) => item.status === "renewal").length,
    churn: events.filter((item) => item.status === "churn").length,
    failed: events.filter((item) => item.status === "failed").length,
    heStarted: events.filter((item) => item.status === "he-started").length,
    nheStarted: events.filter((item) => item.status === "nhe-started").length,
    totalGhsAmount: events.reduce((sum, item) => sum + Number(item.chargingAmount || 0), 0),
    activeSubscriptions,
    questionsUsedToday: usageTotals[0]?.questionsUsed || 0,
  };
};

const getSubscriptionUsage = async () => {
  const [users, callbacks, sdpLogs] = await Promise.all([
    User.find()
      .select(
        "phone subscriptionStatus questionsPlayedToday subscriptionStartTime nextPlayTime"
      )
      .sort({ updatedAt: -1 })
      .lean(),
    GhanaCallbackLog.find()
      .select("msisdn status normalizedStatus reason createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    SDPLog.find()
      .select("msisdn subscriptionStatus normalizedStatus reason createdAt callbackTimestamp")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const lastCallbackByMsisdn = new Map();
  const allCallbacks = [
    ...sdpLogs.map((item) => ({
      msisdn: item.msisdn,
      status: item.subscriptionStatus,
      normalizedStatus: item.normalizedStatus,
      reason: item.reason,
      createdAt: item.createdAt || item.callbackTimestamp,
    })),
    ...callbacks,
  ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  for (const callback of allCallbacks) {
    const key = String(callback.msisdn || "").replace(/\D/g, "");
    if (key && !lastCallbackByMsisdn.has(key)) {
      lastCallbackByMsisdn.set(key, callback);
    }
  }

  return users.map((user) => {
    const cycle = calculateCycleState(user);
    const phoneKey = String(user.phone || "").replace(/\D/g, "");
    const callback = lastCallbackByMsisdn.get(phoneKey);
    const used = Math.min(
      Math.max(Number(cycle.questionsPlayedToday || 0), 0),
      DAILY_QUESTION_LIMIT
    );

    return {
      id: String(user._id),
      msisdn: user.phone,
      subscriptionStatus: cycle.subscriptionStatus,
      questionsPlayedToday: used,
      questionsRemaining: Math.max(DAILY_QUESTION_LIMIT - used, 0),
      subscriptionStartTime: cycle.subscriptionStartTime,
      nextPlayTime: cycle.nextPlayTime,
      lastCallbackStatus:
        callback?.normalizedStatus || callback?.status || "No callback",
      lastCallbackAt: callback?.createdAt || null,
      lastCallbackReason: callback?.reason || "",
    };
  });
};

export const getAdminDashboard = async (req, res) => {
  try {
    const events = await getAdminEvents(req.query);
    const summary = await buildSummary(events);
    const subscriptionUsage = await getSubscriptionUsage();
    res.json({ success: true, summary, data: events, subscriptionUsage });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAdminSubscriptions = async (req, res) => {
  try {
    const events = await getAdminEvents(req.query);
    res.json({ success: true, data: events, total: events.length });
  } catch (err) {
    console.error("Admin subscriptions error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- Users ----------------
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteUser = async (req, res) => {
  
  try {
    const { id } = req.params;
    await User.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- Quizzes ----------------
export const createQuiz = async (req, res) => {
  try {
    const { title, questions } = req.body;

    if (!title || !questions || !questions.length) {
      return res.status(400).json({ success: false, message: "Title and questions are required" });
    }

    const quiz = await Quiz.create({ title, questions, active: true });
    res.status(201).json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all quizzes with active question count
export const getQuizzes = async (req, res) => {
  try {
    const quizzes = await Quiz.find().sort({ createdAt: -1 });
    const quizzesWithActiveCount = quizzes.map((q) => ({
      ...q.toObject(),
      activeQuestions: q.questions.length, // assuming all questions are active
    }));
    res.json({ success: true, quizzes: quizzesWithActiveCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuizById = async (req, res) => {
  try {
    const { quizId } = req.params;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- Questions ----------------
export const addQuestionToQuiz = async (req, res) => {
  try {
    const { quizId, q, options, correctIndex } = req.body;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    quiz.questions.push({ q, options, correctIndex });
    await quiz.save();
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuestion = async (req, res) => {
  try {
    const { quizId, qIndex } = req.params;
    const { q, options, correctIndex } = req.body;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    quiz.questions[qIndex] = { q, options, correctIndex };
    await quiz.save();
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQuestion = async (req, res) => {
  try {
    const { quizId, qIndex } = req.params;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    quiz.questions.splice(qIndex, 1);
    await quiz.save();
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- CSV Upload ----------------
export const uploadCSV = async (req, res) => {
  try {
    const { quizId, title } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    let quiz = null;
    if (quizId) {
      quiz = await Quiz.findById(quizId);
      if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    } else {
      quiz = await Quiz.create({
        title: title?.trim() || `Quiz ${new Date().toLocaleDateString()}`,
        questions: [],
        active: true,
      });
    }

    const results = [];
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", async () => {
        const parsedQuestions = results
          .map((row) => ({
            q: row.q || row.question || row.Question,
            options: [
              row.option1 || row.Option1,
              row.option2 || row.Option2,
              row.option3 || row.Option3,
              row.option4 || row.Option4,
            ].filter(Boolean),
            correctIndex: parseInt(row.correctIndex ?? row.correct ?? row.CorrectIndex, 10),
          }))
          .filter((question) =>
            question.q &&
            question.options.length >= 2 &&
            Number.isInteger(question.correctIndex) &&
            question.correctIndex >= 0 &&
            question.correctIndex < question.options.length
          );

        if (!parsedQuestions.length) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: "CSV me valid questions nahi mile. Columns: q, option1, option2, option3, option4, correctIndex",
          });
        }

        quiz.questions.push(...parsedQuestions);
        await quiz.save();
        fs.unlinkSync(req.file.path);

        res.json({
          success: true,
          message: `${parsedQuestions.length} questions uploaded successfully`,
          questionsAdded: parsedQuestions.length,
          quiz,
        });
      });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
