import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const logDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "logs");
const logFile = path.join(logDir, "unsubscribe.log");

export function logUnsubscribe(step, details = {}) {
  const safe = { ...details };
  if (safe.token) safe.token = "[redacted]";
  if (safe.Authorization) safe.Authorization = "[redacted]";

  let payload = "";
  try {
    payload = Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : "";
  } catch {
    payload = ` ${String(details)}`;
  }

  const line = `[unsubscribe] ${new Date().toISOString()} ${step}${payload}\n`;

  const extraFile = "/tmp/ghsuperwinnings-api.log";

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line);
    fs.appendFileSync(extraFile, line);
  } catch {
    try {
      fs.appendFileSync(extraFile, line);
    } catch {
      // logging must never break unsubscribe
    }
  }

  try {
    process.stdout.write(line);
  } catch {
    console.log(line.trim());
  }
}
