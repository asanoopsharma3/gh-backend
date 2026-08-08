import Quiz from "../models/Quiz.js";
import User from "../models/User.js";
import DailyQuizAttempt from "../models/DailyQuizAttempt.js";
import { TOPUP_REQUIRED_MESSAGE } from "../services/subscriptionService.js";

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const getToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const DUMMY_LEADERBOARD = [
  { userId: "SW-1001", phone: "233241234567", dailyPoints: 100, dailyTimeTaken: 118 },
  { userId: "SW-1002", phone: "233559876543", dailyPoints: 90, dailyTimeTaken: 132 },
  { userId: "SW-1003", phone: "233207654321", dailyPoints: 80, dailyTimeTaken: 145 },
  { userId: "SW-1004", phone: "233501112233", dailyPoints: 70, dailyTimeTaken: 151 },
  { userId: "SW-1005", phone: "233544556677", dailyPoints: 60, dailyTimeTaken: 160 },
  { userId: "SW-1006", phone: "233209988776", dailyPoints: 50, dailyTimeTaken: 168 },
  { userId: "SW-1007", phone: "233551234890", dailyPoints: 40, dailyTimeTaken: 175 },
  { userId: "SW-1008", phone: "233276543210", dailyPoints: 30, dailyTimeTaken: 182 },
];

export const createQuiz = async (req, res) => {
  try {
    const { title, questions } = req.body;
    if (!title || !questions?.length) {
      return res.status(400).json({
        success: false,
        message: "Title and questions are required",
      });
    }

    const quiz = await Quiz.create({
      title,
      questions,
      createdBy: req.user._id,
      active: true,
    });

    return res.status(201).json({ success: true, quiz });
  } catch (err) {
    console.error("createQuiz error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuizzes = async (req, res) => {
  try {
    const quizzes = await Quiz.find().populate("createdBy", "name email");
    return res.json({ success: true, quizzes });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuestionSet = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const questionsInSet = 10;
    const accessType = "paid_set";

    if (user.subscriptionStatus !== "active") {
      return res.status(403).json({
        success: false,
        code: "SUBSCRIPTION_INACTIVE",
        message: "Your subscription is inactive. Please subscribe again.",
      });
    }

    if (user.isAttemptQuiz === true) {
      return res.status(403).json({
        success: false,
        code: "TOPUP_REQUIRED",
        message: TOPUP_REQUIRED_MESSAGE,
      });
    }

    const today = getToday();
    let dailyAttempt = await DailyQuizAttempt.findOne({ userId, date: today });
    if (!dailyAttempt) {
      dailyAttempt = await DailyQuizAttempt.create({
        userId,
        date: today,
        quizId: user.quizId,
        currentQuestionIndex: user.currentQuestionIndex || 0,
        setsCompleted: 0,
        dailyPoints: 0,
        dailyTimeTaken: 0,
      });
    }

    if (dailyAttempt.setsCompleted >= 20) {
      return res.status(403).json({
        success: false,
        message: "You have completed all 20 sets for today. Please try again tomorrow.",
      });
    }

    let { quizId } = user;
    if (!quizId) {
      const activeQuiz = await Quiz.findOne({ active: true });
      if (!activeQuiz) {
        return res.status(404).json({
          success: false,
          message: "No active quizzes available.",
        });
      }
      quizId = activeQuiz._id;
      user.quizId = quizId;
      user.currentQuestionIndex = 0;
      await user.save();
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found." });
    }

    const questionSet = shuffleArray(quiz.questions)
      .slice(0, questionsInSet)
      .map((q) => ({
        _id: q._id,
        q: q.q,
        options: q.options,
        correctIndex: q.correctIndex,
      }));

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.json({
      success: true,
      accessType,
      questionsPerSet: questionsInSet,
      quizAccessStatus: "available",
      subscriptionStatus: user.subscriptionStatus,
      questionsPlayedToday: user.questionsPlayedToday || 0,
      questionsRemaining: questionsInSet - Math.min(user.questionsPlayedToday || 0, questionsInSet),
      quizId: quiz._id,
      questions: questionSet,
      startIndex: 0,
      endIndex: questionSet.length,
      totalQuestions: questionsInSet * 20,
    });
  } catch (err) {
    console.error("getQuestionSet error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuestionIndex = async (req, res) => {
  try {
    const userId = req.user.id;
    const { newIndex, quizId } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (quizId && user.quizId?.toString() !== quizId) {
      return res.status(400).json({
        success: false,
        message: "Invalid quiz ID for user",
      });
    }

    user.currentQuestionIndex = newIndex;
    await user.save();

    await DailyQuizAttempt.findOneAndUpdate(
      { userId, date: getToday() },
      { quizId, currentQuestionIndex: newIndex },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      message: "Question index updated",
      currentQuestionIndex: newIndex,
    });
  } catch (err) {
    console.error("updateQuestionIndex error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const markQuizAttempted = async (req, res) => {
  try {
    const userId = req.user.id;
    const { score, correct, wrong, timeTaken } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.subscriptionStatus !== "active") {
      return res.status(403).json({
        success: false,
        code: "SUBSCRIPTION_INACTIVE",
        message: "Your subscription is inactive. Please subscribe again.",
      });
    }

    const today = getToday();
    let dailyAttempt = await DailyQuizAttempt.findOne({ userId, date: today });
    if (!dailyAttempt) {
      dailyAttempt = await DailyQuizAttempt.create({
        userId,
        date: today,
        setsCompleted: 0,
        dailyPoints: 0,
        dailyTimeTaken: 0,
      });
    }

    const questionsPerSet = 10;
    const finalScore = Number(score || 0);

    user.quizHistory.push({
      quizId: user.quizId,
      totalQuestions: questionsPerSet,
      correct: correct ?? finalScore,
      wrong: wrong ?? questionsPerSet - finalScore,
      score: finalScore,
      timeTaken,
    });

    user.questionsPlayedToday = questionsPerSet;

    if (finalScore < questionsPerSet) {
      user.isAttemptQuiz = true;
      user.currentQuestionIndex = 0;
      user.quizId = null;
      await user.save();

      dailyAttempt.setsCompleted += 1;
      dailyAttempt.dailyPoints += finalScore;
      dailyAttempt.dailyTimeTaken += timeTaken;
      await dailyAttempt.save();

      return res.json({
        success: true,
        quizAccessStatus: "topup_required",
        message: TOPUP_REQUIRED_MESSAGE,
      });
    }

    user.isAttemptQuiz = false;
    user.questionsPlayedToday = 0;
    user.currentQuestionIndex += questionsPerSet;
    await user.save();

    dailyAttempt.setsCompleted += 1;
    dailyAttempt.dailyPoints += finalScore;
    dailyAttempt.dailyTimeTaken += timeTaken;

    if (
      dailyAttempt.setsCompleted >= 20 &&
      dailyAttempt.dailyPoints === questionsPerSet * 20
    ) {
      dailyAttempt.isEligibleForLeaderboard = process.env.IS_ELIGIBLE_FOR_LEADERBOARD === "true";
      user.totalPoints += dailyAttempt.dailyPoints;
      user.totalTimeTaken += dailyAttempt.dailyTimeTaken;
      await user.save();
    }

    await dailyAttempt.save();

    return res.json({
      success: true,
      quizAccessStatus: "available",
      message: "Perfect score. Next 10-question set unlocked.",
    });
  } catch (err) {
    console.error("markQuizAttempted error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getLeaderboard = async (req, res) => {
  try {
    const today = getToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dailyLeaderboard = await DailyQuizAttempt.aggregate([
      {
        $match: {
          date: { $gte: today, $lt: tomorrow },
          isEligibleForLeaderboard: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $project: {
          _id: 0,
          userId: "$userDetails._id",
          phone: "$userDetails.phone",
          dailyPoints: 1,
          dailyTimeTaken: 1,
        },
      },
      { $sort: { dailyPoints: -1, dailyTimeTaken: 1 } },
      { $limit: 10 },
    ]);

    const useDummyOnly = process.env.USE_DUMMY_LEADERBOARD === "true";
    let leaderboard = dailyLeaderboard;
    let isDummy = false;

    if (useDummyOnly || leaderboard.length === 0) {
      leaderboard = DUMMY_LEADERBOARD;
      isDummy = true;
    }

    return res.json({ success: true, leaderboard, isDummy });
  } catch (err) {
    console.error("getLeaderboard error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const resetDailyAttemptStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.isAttemptQuiz = false;
    user.currentQuestionIndex = 0;
    await user.save();

    await DailyQuizAttempt.findOneAndUpdate(
      { userId, date: getToday() },
      {
        $set: {
          setsCompleted: 0,
          dailyPoints: 0,
          dailyTimeTaken: 0,
          isEligibleForLeaderboard: false,
        },
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      message: "Daily attempt reset successfully.",
    });
  } catch (err) {
    console.error("resetDailyAttemptStatus error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("createdBy", "name email");
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }
    return res.json({ success: true, quiz });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
