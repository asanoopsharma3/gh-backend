import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import connectDB, { closePool } from "../config/db.js";
import User from "../models/User.js";

dotenv.config();

const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "Admin";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASS = process.env.SEED_ADMIN_PASS || "Admin@12345";

const run = async () => {
  await connectDB();
  console.log("Connected to PostgreSQL");

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    console.log("Admin already exists:", ADMIN_EMAIL);
    await closePool();
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(ADMIN_PASS, salt);
  const admin = new User({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: hashed,
    role: "admin",
  });

  await admin.save();
  console.log("Admin created:", ADMIN_EMAIL);
  await closePool();
};

run().catch(async (err) => {
  console.error("Seed error:", err);
  await closePool();
  process.exitCode = 1;
});
