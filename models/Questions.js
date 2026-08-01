
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    options: {
      type: [String],
      validate: {
        validator: (arr) => arr.length >= 2,
        message: "At least 2 options are required.",
      },
      required: true,
    },
    correctIndex: {
      type: Number,
      required: true,
      validate: {
        validator: function (val) {
          return val >= 0 && val < this.options.length;
        },
        message: "Correct index must match one of the options.",
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Question", questionSchema);
