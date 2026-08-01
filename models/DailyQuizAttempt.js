import mongoose from "mongoose";

const dailyQuizAttemptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
    required: true,
  },
  setsCompleted: {
    type: Number,
    default: 0,
  },
  dailyPoints: {
    type: Number,
    default: 0,
  },
  dailyTimeTaken: {
    type: Number, // in seconds
    default: 0,
  },
  isEligibleForLeaderboard: {
    type: Boolean,
    default: false,
  },
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Quiz",
    default: null,
  },
  currentQuestionIndex: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Ensure unique daily attempt per user
dailyQuizAttemptSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.model("DailyQuizAttempt", dailyQuizAttemptSchema);
