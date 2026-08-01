import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";

dotenv.config();

const run = async () => {
  await connectDB();

  const result = await User.updateMany({}, [
    {
      $set: {
        subscriptionStatus: {
          $ifNull: ["$subscriptionStatus", "inactive"],
        },
        questionsPlayedToday: {
          $ifNull: ["$questionsPlayedToday", 0],
        },
        subscriptionStartTime: {
          $ifNull: ["$subscriptionStartTime", null],
        },
        nextPlayTime: {
          $ifNull: ["$nextPlayTime", null],
        },
      },
    },
  ]);

  console.log(`Subscription migration complete. Updated ${result.modifiedCount} users.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Subscription migration failed:", error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
