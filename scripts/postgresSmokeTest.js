import { ensureReady, closePool } from "../config/db.js";
import { TABLES } from "../config/schema.js";
import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import DailyQuizAttempt from "../models/DailyQuizAttempt.js";
import GhanaCallbackLog from "../models/GhanaCallbackLog.js";
import SDPLog from "../models/SDPLog.js";
import SDPCallback from "../models/SDPCallback.js";
import CGWCallback from "../models/CGWCallback.js";
import CGWCallbackLog from "../models/CGWCallbackLog.js";
import MsisdnLog from "../models/MsisdnLog.js";

const phone = "+233000009991";
const msisdn = "233000009991";
const checks = [];

const check = (name, condition, detail = "") => {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const cleanup = async (db) => {
  await db.query("DELETE FROM daily_quiz_attempts WHERE user_id IN (SELECT id FROM users WHERE phone = $1)", [phone]);
  await db.query("DELETE FROM users WHERE phone = $1", [phone]);
  await db.query("DELETE FROM quizzes WHERE title = $1", ["PG smoke quiz"]);
  for (const table of ["ghana_callback_logs", "sdp_logs", "sdp_callbacks", "cgw_callbacks", "cgw_callback_logs", "msisdn_logs"]) {
    await db.query(`DELETE FROM ${table} WHERE msisdn = $1`, [msisdn]);
  }
};

const run = async () => {
  const db = await ensureReady();
  console.log(`Connected to ${process.env.DB_HOST}/${process.env.DB_DATABASE}`);
  await cleanup(db);

  const tableResult = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  const names = new Set(tableResult.rows.map((row) => row.tablename));
  const missing = TABLES.filter((table) => !names.has(table));
  check("tables created", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `${TABLES.length} tables`);
  const callbackColumns = await db.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cgw_callback_logs'`
  );
  const columnNames = new Set(callbackColumns.rows.map((row) => row.column_name));
  const idType = callbackColumns.rows.find((row) => row.column_name === "id")?.data_type;
  check(
    "cgw_callback_logs columns",
    columnNames.has("msisdn") && columnNames.has("raw_body") && !columnNames.has("doc") && idType === "bigint",
    `id=${idType}`
  );

  const user = await User.create({ phone });
  check("user insert", Boolean(user._id));
  user.subscriptionStatus = "active";
  user.subscriptionStartTime = new Date();
  user.nextPlayTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();

  const found = await User.findOne({ $or: [{ phone }, { phone: msisdn }] });
  check("user read back", found?.phone === phone && found.subscriptionStatus === "active", found?.phone || "not found");

  const incremented = await User.findOneAndUpdate(
    {
      _id: user._id,
      subscriptionStatus: "active",
      questionsPlayedToday: { $lt: 10 },
      nextPlayTime: { $gt: new Date() },
    },
    { $inc: { questionsPlayedToday: 1 } },
    { new: true }
  );
  check("question counter update", incremented?.questionsPlayedToday === 1, String(incremented?.questionsPlayedToday));

  const quiz = await Quiz.create({
    title: "PG smoke quiz",
    active: true,
    questions: [{ q: "2 + 2", options: ["3", "4"], correctIndex: 1 }],
  });
  quiz.questions.push({ q: "3 + 3", options: ["5", "6"], correctIndex: 1 });
  await quiz.save();
  const storedQuiz = await Quiz.findById(quiz._id);
  check(
    "quiz insert",
    storedQuiz?.questions?.length === 2 && storedQuiz.questions.every((item) => item._id),
    `${storedQuiz?.questions?.length || 0} questions`
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  await DailyQuizAttempt.create({
    userId: user._id,
    date: today,
    dailyPoints: 20,
    dailyTimeTaken: 30,
    isEligibleForLeaderboard: true,
  });
  const leaderboard = await DailyQuizAttempt.aggregate([
    { $match: { date: { $gte: today, $lt: tomorrow }, isEligibleForLeaderboard: true, userId: user._id } },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "userDetails" } },
    { $unwind: "$userDetails" },
    { $project: { _id: 0, userId: "$userDetails._id", phone: "$userDetails.phone", dailyPoints: 1, dailyTimeTaken: 1 } },
    { $sort: { dailyPoints: -1, dailyTimeTaken: 1 } },
    { $limit: 10 },
  ]);
  check("leaderboard join", leaderboard[0]?.phone === phone && leaderboard[0]?.dailyPoints === 20);

  const from = new Date(Date.now() - 60 * 1000);
  const to = new Date(Date.now() + 60 * 1000);
  const ghana = await GhanaCallbackLog.create({
    callbackType: "CGW",
    flow: "HE",
    method: "GET",
    msisdn,
    offerCode: "9923310010",
    status: "200",
    normalizedStatus: "success",
    chargingAmount: 1,
    rawQuery: { msisdn },
    rawBody: { ok: true },
  });
  const ghanaRows = await GhanaCallbackLog.find({
    createdAt: { $gte: from, $lte: to },
    callbackType: "CGW",
    msisdn,
  }).lean();
  check("callback log insert", ghanaRows.some((row) => String(row._id) === String(ghana._id)) && ghana._id.toString() === String(ghana._id));

  const sdp = await SDPLog.create({
    method: "POST",
    msisdn,
    offerCode: "9923310010",
    chargeAmount: 1,
    subscriptionStatus: "A",
    subscriberLifeCycle: "SUB",
    normalizedStatus: "success",
    rawBody: { requestParam: { data: [{ name: "Msisdn", value: msisdn }] } },
    type: "SHOULD_NOT_BE_STORED",
  });
  const storedSdp = await SDPLog.findById(sdp._id).lean();
  check(
    "sdp log keeps mongo fields only",
    storedSdp?.msisdn === msisdn && storedSdp.subscriberLifeCycle === "SUB" && storedSdp.type === undefined
  );

  await SDPCallback.create({ method: "POST", msisdn, status: "A", lifecycle: "SUB", rawBody: { source: "smoke" } });
  await SDPCallback.create({ method: "POST", msisdn, status: "A", lifecycle: "REN", rawBody: { source: "smoke-2" } });
  await CGWCallback.create({ method: "GET", msisdn, status: "200", rawQuery: { msisdn } });
  await CGWCallback.create({ method: "GET", msisdn, status: "200", rawQuery: { msisdn, charge: 2 } });
  await CGWCallbackLog.create({ type: "CGW", method: "GET", msisdn, status: "200", rawBody: { source: "smoke" } });
  await CGWCallbackLog.create({ type: "CGW", method: "GET", msisdn, status: "200", rawBody: { source: "smoke-2" } });
  await GhanaCallbackLog.create({
    callbackType: "CGW",
    flow: "HE",
    method: "GET",
    msisdn,
    status: "200",
    rawBody: { source: "smoke-2" },
  });
  await MsisdnLog.create({ msisdn, source: "HE", offerCode: "9923310010" });
  await MsisdnLog.create({ msisdn, source: "HE", offerCode: "9923310010" });

  const counts = {};
  for (const table of ["ghana_callback_logs", "sdp_callbacks", "cgw_callbacks", "cgw_callback_logs", "msisdn_logs"]) {
    const result = await db.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE msisdn = $1`, [msisdn]);
    counts[table] = result.rows[0].count;
  }
  check(
    "same phone callback inserts again",
    counts.ghana_callback_logs === 2 &&
      counts.sdp_callbacks === 2 &&
      counts.cgw_callbacks === 2 &&
      counts.cgw_callback_logs === 2 &&
      counts.msisdn_logs === 2,
    JSON.stringify(counts)
  );

  let duplicateBlocked = false;
  try {
    await User.create({ phone });
  } catch (error) {
    duplicateBlocked = /duplicate/i.test(error.message);
  }
  check("duplicate phone blocked on users only", duplicateBlocked);

  await cleanup(db);
  const left = await db.query("SELECT COUNT(*)::int AS count FROM users WHERE phone = $1", [phone]);
  check("test rows removed", left.rows[0].count === 0);

  const failed = checks.filter((item) => !item.ok);
  if (failed.length) {
    throw new Error(`${failed.length} check(s) failed: ${failed.map((item) => item.name).join(", ")}`);
  }
  console.log("PostgreSQL smoke test passed");
};

run()
  .catch((error) => {
    console.error("PostgreSQL smoke test failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
