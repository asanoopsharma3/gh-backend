import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  otp: String,
  otpExpiry: Date,
  lastOtpSent: Date,
  isPhoneVerified: { type: Boolean, default: false },
  verifyAttempts: { type: Number, default: 0 },
  isAttemptQuiz: { type: Boolean, default: false },
  currentSzlAssigned: { type: Number, default: 0 },
  subscriptionStatus: {
    type: String,
    enum: ["inactive", "active", "suspended"],
    default: "inactive",
    index: true,
  },
  questionsPlayedToday: { type: Number, default: 0, min: 0 },
  subscriptionStartTime: { type: Date, default: null },
  nextPlayTime: { type: Date, default: null },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", default: null },
  currentQuestionIndex: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  totalAmountSpent: { type: Number, default: 0 },
  firstTimeQuiz: { type: Boolean, default: true },
  totalTimeTaken: { type: Number, default: 0 },

  // ⭐ NEW FIELD - full quiz statistics
  quizHistory: [
    {
      quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz" },
      totalQuestions: Number,
      correct: Number,
      wrong: Number,
      score: Number,
      timeTaken: Number,
      date: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

export default mongoose.model("User", userSchema);
