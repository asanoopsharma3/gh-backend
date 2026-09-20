import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import csv from "csv-parser";
import fs from "fs";
import {
  buildDailySubscriptionReport,
  resolveReportRange,
} from "../services/dailySubscriptionReport.js";
import {
  getPaginatedAdminEvents,
  loadDailySubscriptionEvents,
} from "../services/adminEventQuery.js";

const buildSummary = async (query, pageData) => {
  const events = pageData.summaryEvents || pageData.events || [];
  const [activeSubscriptions, totalUsers] = await Promise.all([
    User.countDocuments({ subscriptionStatus: "active" }).maxTimeMS(8000).catch(() => 0),
    User.countDocuments().maxTimeMS(8000).catch(() => 0),
  ]);

  return {
    totalEvents: Number(pageData.total || events.length || 0),
    totalSubscribers: Number(pageData.total || 0),
    totalUsers,
    success: events.filter((item) => item.status === "success").length,
    renewals: events.filter((item) => item.status === "renewal").length,
    churn: events.filter((item) => item.status === "churn").length,
    failed: events.filter((item) => item.status === "failed").length,
    heStarted: 0,
    nheStarted: 0,
    totalGhsAmount: events
      .filter((item) => item.status === "success" || item.status === "renewal")
      .reduce((sum, item) => sum + (Number(item.chargingAmount) >= 50 ? Number(item.chargingAmount) / 100 : Number(item.chargingAmount || 0)), 0),
    activeSubscriptions,
    questionsUsedToday: 0,
  };
};

const getDailySubscriptionReport = async (query = {}) => {
  const range = resolveReportRange(query);
  const loaded = await loadDailySubscriptionEvents(range.from, range.to);
  const events = Array.isArray(loaded) ? loaded : loaded.events || [];
  const extras = loaded?.extras || {};
  const report = buildDailySubscriptionReport(events, range);
  return {
    ...report,
    summary: {
      ...report.summary,
      renewals: Math.max(Number(report.summary.renewals || 0), Number(extras.renewals || 0)),
      unsub: Math.max(Number(report.summary.unsub || 0), Number(extras.unsub || 0)),
    },
  };
};

export const getAdminDashboard = async (req, res) => {
  try {
    const pageData = await getPaginatedAdminEvents(req.query);
    const summary = await buildSummary(req.query, pageData);
    res.json({
      success: true,
      summary,
      data: pageData.events,
      total: pageData.total,
      range: pageData.range,
      subscriptionUsage: [],
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.json({
      success: true,
      summary: {
        totalEvents: 0,
        totalSubscribers: 0,
        success: 0,
        renewals: 0,
        churn: 0,
        failed: 0,
        totalGhsAmount: 0,
      },
      data: [],
      total: 0,
      warning: err.message,
      subscriptionUsage: [],
    });
  }
};

export const getAdminSubscriptions = async (req, res) => {
  try {
    const { events, total, range } = await getPaginatedAdminEvents(req.query);
    res.json({ success: true, data: events, total, range });
  } catch (err) {
    console.error("Admin subscriptions error:", err);
    res.json({ success: true, data: [], total: 0, warning: err.message });
  }
};

export const getDailySubscriptions = async (req, res) => {
  try {
    const dailySubscriptions = await getDailySubscriptionReport(req.query);
    res.json({ success: true, ...dailySubscriptions });
  } catch (err) {
    console.error("Daily subscriptions error:", err);
    const range = resolveReportRange(req.query);
    res.json({
      success: true,
      ...buildDailySubscriptionReport([], range),
      warning: err.message,
    });
  }
};

// ---------------- Users ----------------
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().limit(5000).maxTimeMS(8000).lean();
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
