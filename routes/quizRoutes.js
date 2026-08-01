import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import { getQuestionSet, updateQuestionIndex, markQuizAttempted, getLeaderboard, resetDailyAttemptStatus } from "../controllers/quizController.js"; // Import new controllers

const quizRouter = express.Router();

// JWT middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token missing" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // contains userId
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

/**
 * ✅ GET /api/quiz/questionset
 * Fetch a set of questions for the user (authenticated)
 */
quizRouter.get("/questionset", authenticate,getQuestionSet);

/**
 * ✅ POST /api/quiz/update-index
 * Update the user's current question index (authenticated)
 */
quizRouter.post("/update-index", authenticate, updateQuestionIndex);

/**
 * ✅ POST /api/quiz/mark-attempted
 * Mark user as attempted quiz and reset progress (authenticated)
 */
quizRouter.post("/mark-attempted", authenticate, markQuizAttempted);

/**
 * ✅ GET /api/quiz/leaderboard
 * Get the top 2 users for the leaderboard
 */
quizRouter.get("/leaderboard", authenticate, getLeaderboard);

/**
 * ✅ POST /api/quiz/reset-daily-attempt
 * Reset user's daily attempt status after subscription
 */
quizRouter.post("/reset-daily-attempt", authenticate, resetDailyAttemptStatus);

/**
 * ✅ POST /api/quiz/add
 * Add a new quiz (for admin)
 */
quizRouter.post("/add", async (req, res) => {
  try {
    const { title, questions, active } = req.body;

    if (!title || !questions || questions.length === 0) {
      return res.status(400).json({ error: "Title and questions are required" });
    }

    const quiz = new Quiz({
      title,
      questions,
      active: active ?? true
    });

    await quiz.save();
    res.status(201).json({ success: true, quiz });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * ✅ POST /api/quiz/attempt
 * Mark user as attempted quiz (authenticated)
 */
quizRouter.post("/attempt", authenticate, async (req, res) => {
  const userId = req.user.id; // JWT se directly le liya
  const { quizId } = req.body;

  try {
    const user = await User.findById(userId);
    const quiz = await Quiz.findById(quizId);

    if (!user) return res.status(404).json({ message: "User not found" });
    if (!quiz || !quiz.active) return res.status(404).json({ message: "Quiz not found or inactive" });

    if (user.isAttemptQuiz) {
      return res.status(400).json({ message: "You have already attempted the quiz" });
    }

    user.isAttemptQuiz = true;
    await user.save();

    res.json({ message: "Quiz attempted successfully", quiz, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ✅ GET /api/quiz/status
 * Check if user has attempted quiz (authenticated)
 */
quizRouter.get("/status", authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ isAttemptQuiz: user.isAttemptQuiz });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

export default quizRouter;
