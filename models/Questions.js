import { createModel } from "../db/documentModel.js";

const Question = createModel({
  table: "questions",
  columns: {
    question: "question",
    options: { column: "options", type: "text[]" },
    correctIndex: { column: "correct_index", type: "number" },
    createdBy: { column: "created_by", type: "id" },
  },
  required: ["question", "options", "correctIndex", "createdBy"],
  refs: {
    createdBy: "users",
  },
});

export default Question;
