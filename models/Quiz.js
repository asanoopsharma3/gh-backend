import { createModel } from "../db/documentModel.js";

const Quiz = createModel({
  table: "quizzes",
  columns: {
    title: "title",
    createdBy: { column: "created_by", type: "id", default: null },
    active: { column: "active", type: "boolean", default: true },
  },
  required: ["title"],
  relations: {
    questions: {
      table: "quiz_questions",
      foreignKey: "quiz_id",
      position: "position",
      order: "position, id",
      columns: {
        q: "q",
        options: { column: "options", type: "text[]" },
        correctIndex: { column: "correct_index", type: "number" },
      },
    },
  },
  refs: {
    createdBy: "users",
  },
});

export default Quiz;
