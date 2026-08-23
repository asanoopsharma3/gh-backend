// admin.js
import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import multer from "multer";
import {
  getAllUsers,
  createQuiz,
  getQuizzes,
  deleteUser,
  getQuizById,
  updateQuestion,
  deleteQuestion,
  addQuestionToQuiz,
  uploadCSV,
  getAdminDashboard,
  getAdminSubscriptions,
  getAdminUnsubscribers
} from "../controllers/adminController.js";

dotenv.config();
const router = express.Router();
const upload = multer({ dest: "uploads/" });

// ---------------- JWT Middleware ----------------
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded; // optional: store decoded info in req
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

// ---------------- Admin Login ----------------
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

router.post("/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password)
    return res.status(400).json({ success: false, message: "Email & password required" });

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      message: "Admin credentials are not configured",
    });
  }

  const configuredEmail = String(ADMIN_EMAIL).trim().toLowerCase();

  if (email === configuredEmail && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ email: configuredEmail }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, message: "Invalid credentials" });
});

// ---------------- Users ----------------
router.get("/dashboard", verifyAdminToken, getAdminDashboard);
router.get("/subscriptions", verifyAdminToken, getAdminSubscriptions);
router.get("/unsubscribers", verifyAdminToken, getAdminUnsubscribers);
router.get("/users", verifyAdminToken, getAllUsers);
router.delete("/users/:id", verifyAdminToken, deleteUser);

// ---------------- Quizzes ----------------
router.post("/quizzes", verifyAdminToken, createQuiz);
router.get("/quizzes", verifyAdminToken, getQuizzes);
router.get("/quizzes/:quizId", verifyAdminToken, getQuizById);

// ---------------- Questions ----------------
router.post("/quizzes/questions", verifyAdminToken, addQuestionToQuiz);
router.put("/quizzes/:quizId/questions/:qIndex", verifyAdminToken, updateQuestion);
router.delete("/quizzes/:quizId/questions/:qIndex", verifyAdminToken, deleteQuestion);

// ---------------- CSV Upload ----------------
router.post(
  "/quizzes/upload-csv",
  verifyAdminToken,
  upload.single("file"),
  uploadCSV
);

export default router;
