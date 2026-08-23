
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};


export const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ success: false, message: "User already exists" });

    const user = await User.create({
      name,
      email,
      password, 
      role: role || "user",
    });

    res.status(201).json({
      success: true,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
      token: generateToken(user),
    });
  } catch (error) {
    console.error("registerUser error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });
    const user = await User.findOne({ email });
  
    if (!user) return res.status(400).json({ success: false, message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
      console.log(isMatch)
    if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

    res.json({
      success: true,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
      token: generateToken(user),
    });
  } catch (error) {
    console.error("loginUser error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-otp -otpExpiry -verifyAttempts")
      .populate("quizHistory.quizId", "title");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const quizHistory = user.quizHistory || [];
    const profileStats = quizHistory.reduce(
      (stats, item) => {
        const totalQuestions = Number(item.totalQuestions || 0);
        const correct = Number(item.correct ?? item.score ?? 0);
        const wrong = Number(item.wrong ?? Math.max(totalQuestions - correct, 0));

        stats.totalAttempts += 1;
        stats.totalQuestionsPlayed += totalQuestions;
        stats.totalCorrect += correct;
        stats.totalWrong += wrong;
        stats.totalTimeTaken += Number(item.timeTaken || 0);

        if (totalQuestions > 0 && correct === totalQuestions) {
          stats.perfectSets += 1;
        } else {
          stats.failedSets += 1;
        }

        return stats;
      },
      {
        totalAttempts: 0,
        totalQuestionsPlayed: 0,
        totalCorrect: 0,
        totalWrong: 0,
        totalTimeTaken: 0,
        perfectSets: 0,
        failedSets: 0,
      }
    );

    profileStats.topupCount = user.currentSzlAssigned || 0;
    profileStats.questionsPlayedInCurrentSet = user.questionsPlayedToday || 0;
    profileStats.subscriptionStatus = user.subscriptionStatus || "inactive";
    profileStats.quizAccessStatus = user.isAttemptQuiz ? "topup_required" : "available";
    profileStats.winningChance =
      profileStats.totalQuestionsPlayed > 0
        ? Number(((profileStats.totalCorrect / profileStats.totalQuestionsPlayed) * 100).toFixed(2))
        : 0;

    res.json({ success: true, user, profileStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });}
};


export const updateMe = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email;
   
    if (password) user.password = password;

    await user.save();

   
    const updatedUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    res.json({
      success: true,
      user: updatedUser,
      token: generateToken(user),
    });
  } catch (error) {
    console.error("updateMe error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
