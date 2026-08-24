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

  console.log(`[unsubscribe] ${new Date().toISOString()} ${step}${payload}`);
}
