import { createModel } from "../db/documentModel.js";

const User = createModel({
  table: "users",
  columns: {
    phone: "phone",
    otp: "otp",
    otpExpiry: { column: "otp_expiry", type: "date" },
    lastOtpSent: { column: "last_otp_sent", type: "date" },
    isPhoneVerified: { column: "is_phone_verified", type: "boolean", default: false },
    verifyAttempts: { column: "verify_attempts", type: "number", default: 0 },
    isAttemptQuiz: { column: "is_attempt_quiz", type: "boolean", default: false },
    currentSzlAssigned: { column: "current_szl_assigned", type: "number", default: 0 },
    subscriptionStatus: { column: "subscription_status", default: "inactive" },
    questionsPlayedToday: { column: "questions_played_today", type: "number", default: 0 },
    subscriptionStartTime: { column: "subscription_start_time", type: "date", default: null },
    nextPlayTime: { column: "next_play_time", type: "date", default: null },
    quizId: { column: "quiz_id", type: "id", default: null },
    currentQuestionIndex: { column: "current_question_index", type: "number", default: 0 },
    totalPoints: { column: "total_points", type: "number", default: 0 },
    totalAmountSpent: { column: "total_amount_spent", type: "number", default: 0 },
    firstTimeQuiz: { column: "first_time_quiz", type: "boolean", default: true },
    totalTimeTaken: { column: "total_time_taken", type: "number", default: 0 },
    name: "name",
    email: "email",
    password: "password",
    role: { column: "role", default: "user" },
  },
  enums: {
    subscriptionStatus: ["inactive", "active", "suspended"],
  },
  relations: {
    quizHistory: {
      table: "user_quiz_history",
      foreignKey: "user_id",
      order: "id",
      columns: {
        quizId: { column: "quiz_id", type: "id" },
        totalQuestions: { column: "total_questions", type: "number" },
        correct: { column: "correct", type: "number" },
        wrong: { column: "wrong", type: "number" },
        score: { column: "score", type: "number" },
        timeTaken: { column: "time_taken", type: "number" },
        date: { column: "played_at", type: "date" },
      },
    },
  },
  refs: {
    quizId: "quizzes",
    "quizHistory.quizId": "quizzes",
  },
  beforeSave(doc) {
    if (!Array.isArray(doc.quizHistory)) doc.quizHistory = [];
    for (const item of doc.quizHistory) {
      if (item && item.date == null) item.date = new Date();
    }
  },
});

export default User;
