// node scripts/seedAdmin.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import User from "../models/User.js"; // adjust path as needed

dotenv.config();

const MONGO = process.env.MONGO_URI; // set in .env
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "Admin";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASS = process.env.SEED_ADMIN_PASS || "Admin@12345";

const run = async () => {
  try {
    await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("Connected to DB");

    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      console.log("Admin already exists:", ADMIN_EMAIL);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(ADMIN_PASS, salt);

    const admin = new User({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashed,
      role: "admin"
    });

    await admin.save();
    console.log("Admin created:", ADMIN_EMAIL);
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
};

run();
