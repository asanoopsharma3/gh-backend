import dotenv from "dotenv";
import connectDB, { closePool } from "../config/db.js";
import User from "../models/User.js";

dotenv.config();

const run = async () => {
  await connectDB();

  const users = await User.find({});
  let modifiedCount = 0;
  for (const user of users) {
    let changed = false;
    if (user.subscriptionStatus == null) {
      user.subscriptionStatus = "inactive";
      changed = true;
    }
    if (user.questionsPlayedToday == null) {
      user.questionsPlayedToday = 0;
      changed = true;
    }
    if (user.subscriptionStartTime === undefined) {
      user.subscriptionStartTime = null;
      changed = true;
    }
    if (user.nextPlayTime === undefined) {
      user.nextPlayTime = null;
      changed = true;
    }
    if (changed) {
      await user.save();
      modifiedCount += 1;
    }
  }

  console.log(`Subscription migration complete. Updated ${modifiedCount} users.`);
  await closePool();
};

run().catch(async (error) => {
  console.error("Subscription migration failed:", error);
  await closePool();
  process.exitCode = 1;
});
