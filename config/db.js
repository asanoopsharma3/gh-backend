import pg from "pg";
import dotenv from "dotenv";
import { ensureSchema } from "./schema.js";

dotenv.config();

const { Pool } = pg;

let pool;

const poolConfig = () => {
  if (!process.env.DB_HOST || !process.env.DB_USERNAME || !process.env.DB_DATABASE) {
    throw new Error(
      "PostgreSQL config missing. Set DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, and DB_DATABASE."
    );
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  };
};

export function getPool() {
  if (!pool) pool = new Pool(poolConfig());
  return pool;
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

const createDatabase = async () => {
  const database = process.env.DB_DATABASE;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    throw new Error("Invalid DB_DATABASE name");
  }

  const admin = new Pool({ ...poolConfig(), database: "postgres" });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${database}`);
      console.log(`PostgreSQL database created: ${database}`);
    }
  } finally {
    await admin.end();
  }
};

export async function ensureReady() {
  const db = getPool();
  try {
    await db.query("SELECT 1");
  } catch (error) {
    if (error.code !== "3D000") throw error;
    await closePool();
    await createDatabase();
    await getPool().query("SELECT 1");
  }
  await ensureSchema(getPool());
  return getPool();
}

const connectDB = async () => {
  if (process.env.MONGO_URI) {
    console.error("MONGO_URI is set. This API uses only PostgreSQL. Remove MONGO_URI before starting.");
    process.exit(1);
  }

  try {
    await ensureReady();
    console.log(`PostgreSQL connected: ${process.env.DB_HOST}/${process.env.DB_DATABASE}`);
  } catch (error) {
    console.error(`PostgreSQL connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
