import dotenv from "dotenv";

dotenv.config({ quiet: true });

try {
  if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true);
  if (process.stderr._handle?.setBlocking) process.stderr._handle.setBlocking(true);
} catch {
  // ignore on platforms without a blocking handle
}
