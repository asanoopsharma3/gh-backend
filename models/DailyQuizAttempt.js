import { createModel } from "../db/documentModel.js";

const DailyQuizAttempt = createModel({
  table: "daily_quiz_attempts",
  columns: {
    userId: { column: "user_id", type: "id" },
    date: { column: "attempt_date", type: "date", default: () => new Date() },
    setsCompleted: { column: "sets_completed", type: "number", default: 0 },
    dailyPoints: { column: "daily_points", type: "number", default: 0 },
    dailyTimeTaken: { column: "daily_time_taken", type: "number", default: 0 },
    isEligibleForLeaderboard: { column: "is_eligible_for_leaderboard", type: "boolean", default: false },
    quizId: { column: "quiz_id", type: "id", default: null },
    currentQuestionIndex: { column: "current_question_index", type: "number", default: 0 },
  },
  required: ["userId"],
  refs: {
    userId: "users",
    quizId: "quizzes",
  },
});

export default DailyQuizAttempt;
