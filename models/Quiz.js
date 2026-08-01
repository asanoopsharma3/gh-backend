// models/Quiz.js
import mongoose from "mongoose";
const questionSchema = new mongoose.Schema({
  q: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctIndex: { type: Number, required: true } 
});

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true },
  questions: [questionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  active: { type: Boolean, default: true }
}, { timestamps: true }); 

const Quiz = mongoose.model("Quiz", quizSchema);
export default Quiz;
