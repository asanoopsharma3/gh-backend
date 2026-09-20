import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import SDPLog from "../models/SDPLog.js";
import csv from "csv-parser";
import fs from "fs";
import {
  buildDailySubscriptionReport,
  endOfGhanaDay,
  resolveReportRange,
  startOfGhanaDay,
} from "../services/dailySubscriptionReport.js";
import {
  INITIAL_OFFER_CODE,
  getOfferPlan,
} from "../config/cgwconfig.js";

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

const DASHBOARD_SCAN_LIMIT = 500;
const MAX_DASHBOARD_RANGE_DAYS = 31;

const toDateOnly = (value) => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

const resolveDashboardRange = (query = {}) => {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const fromInput = toDateOnly(query.fromDate || query.from || query.date);
  const toInput = toDateOnly(query.toDate || query.to || query.date || fromInput);
  let from = fromInput ? startOfDay(fromInput) : startOfDay(monthStart);
  let to = toInput ? endOfDay(toInput) : endOfDay(today);

  if (from > to) {
    const swap = from;
    from = startOfDay(to);
    to = endOfDay(swap);
  }

  const maxFrom = new Date(to.getTime() - MAX_DASHBOARD_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (from < maxFrom) from = maxFrom;

  return { from, to };
};

const createdAtFilter = (from, to) => ({
  createdAt: { $gte: from, $lte: to },
});

const safeSortedFind = (model, filter, sort = { createdAt: -1 }, limit = DASHBOARD_SCAN_LIMIT) =>
  model
    .find(filter)
    .sort(sort)
    .allowDiskUse(true)
    .limit(limit)
    .maxTimeMS(12000)
    .lean();

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
  if (
    ["success", "successful", "active", "a", "200", "9", "115"].includes(statusText) ||
    statusText.replace(/[\s_-]+/g, "").includes("alreadysubscrib") ||
    (statusText.includes("already") && statusText.includes("subscrib"))
  ) {
    return "success";
  }
  if (["failed", "failure", "fail", "deactivated", "d", "suspended", "s", "1", "11", "12", "13", "91", "112", "150", "186", "644"].includes(statusText)) {
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

const getAdminEvents = async (query = {}) => {
  const { from, to } = resolveDashboardRange(query);
  const filter = createdAtFilter(from, to);
  const report = query.report;
  const search = query.search;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(
    Number(query.limit) > 50 ? 500 : 50,
    Math.max(1, Number(query.limit) || 10)
  );
  const scanLimit = Math.min(DASHBOARD_SCAN_LIMIT, Math.max(limit * page, 100));

  const [callbacks, sdpLogs] = await Promise.all([
    safeSortedFind(
      GhanaCallbackLog,
      { ...filter, callbackType: { $ne: "SDP" } },
      { createdAt: -1 },
      scanLimit
    ),
    safeSortedFind(SDPLog, filter, { createdAt: -1 }, scanLimit).catch(() =>
      safeSortedFind(
        SDPLog,
        { callbackTimestamp: filter.createdAt },
        { callbackTimestamp: -1 },
        scanLimit
      )
    ),
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

  const events = [...sdpEvents, ...cgwEvents]
    .filter((item) => matchesReport(item, report))
    .filter((item) => matchesSearch(item, search))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const start = (page - 1) * limit;
  return {
    events: events.slice(start, start + limit),
    total: events.length,
    summaryEvents: events,
    range: { from, to },
  };
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

const loadDailySubscriptionEvents = async (from, to) => {
  const createdAt = {
    $gte: startOfGhanaDay(from),
    $lte: endOfGhanaDay(to),
  };

  const [callbacks, sdpLogs, users] = await Promise.all([
    GhanaCallbackLog.find({ createdAt })
      .select("msisdn offerCode status normalizedStatus lifecycle reason chargingAmount createdAt callbackType flow rawBody rawQuery")
      .sort({ createdAt: 1 })
      .allowDiskUse(true)
      .maxTimeMS(12000)
      .lean(),
    SDPLog.find({ createdAt })
      .select("msisdn offerCode planId subscriptionStatus subscriberLifeCycle command status lifecycle reason chargeAmount createdAt callbackTimestamp channel")
      .sort({ createdAt: 1 })
      .allowDiskUse(true)
      .maxTimeMS(12000)
      .lean(),
    User.find({
      subscriptionStartTime: createdAt,
    })
      .select("phone subscriptionStartTime subscriptionStatus createdAt")
      .sort({ subscriptionStartTime: 1 })
      .allowDiskUse(true)
      .maxTimeMS(12000)
      .lean(),
  ]);

  const dailyPlan = getOfferPlan(INITIAL_OFFER_CODE);

  return [
    ...callbacks.map((item) => ({
      ...item,
      source: item.callbackType || "CGW",
    })),
    ...sdpLogs.map((item) => ({
      ...item,
      source: "SDP",
      status: item.subscriptionStatus || item.status,
      lifecycle: item.subscriberLifeCycle || item.lifecycle,
    })),
    ...users.map((user) => ({
      msisdn: user.phone,
      offerCode: INITIAL_OFFER_CODE,
      status: "200",
      lifecycle: "SUB",
      source: "USER",
      flow: "LOCAL",
      chargingAmount: dailyPlan.amountGhs,
      createdAt: user.subscriptionStartTime || user.createdAt,
    })),
  ];
};

const getDailySubscriptionReport = async (query = {}) => {
  const range = resolveReportRange(query);
  const events = await loadDailySubscriptionEvents(range.from, range.to);
  return buildDailySubscriptionReport(events, range);
};

export const getAdminDashboard = async (req, res) => {
  try {
    const { events, total, summaryEvents, range } = await getAdminEvents(req.query);
    const summary = await buildSummary(summaryEvents);
    res.json({
      success: true,
      summary,
      data: events,
      total,
      range,
      subscriptionUsage: [],
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAdminSubscriptions = async (req, res) => {
  try {
    const { events, total } = await getAdminEvents(req.query);
    res.json({ success: true, data: events, total });
  } catch (err) {
    console.error("Admin subscriptions error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDailySubscriptions = async (req, res) => {
  try {
    const dailySubscriptions = await getDailySubscriptionReport(req.query);
    res.json({ success: true, ...dailySubscriptions });
  } catch (err) {
    console.error("Daily subscriptions error:", err);
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
