const compact = (value) => {
  if (value === undefined || value === null || value === "") return "-";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g, " ").slice(0, 240);
};

export const logCallback = (channel, event, fields = {}) => {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${compact(value)}`);
  const line = `[${channel}] ${event} ${parts.join(" ")}`.trim();
  if (event === "error" || event === "save_error" || event === "rejected") {
    console.error(line);
    return;
  }
  console.log(line);
};

export const savedId = (doc) => (doc?._id != null ? String(doc._id) : "-");
